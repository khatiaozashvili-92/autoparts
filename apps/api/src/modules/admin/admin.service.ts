import { Injectable, Logger } from '@nestjs/common';
import { AppError, ErrorCode, FitmentSource, errors, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { PricingService } from '../pricing/pricing.service.js';
import { SearchService } from '../search/search.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { AuditService } from './audit.service.js';

export type ConflictAction = 'approve' | 'reject' | 'map' | 'investigate';

@Injectable()
export class AdminService {
  private readonly logger = new Logger('AdminService');

  constructor(
    private readonly db: DatabaseService,
    private readonly pricing: PricingService,
    private readonly search: SearchService,
    private readonly ordersService: OrdersService,
    private readonly audit: AuditService,
  ) {}

  /* ───────────────────────── fitment conflicts ───────────────────────── */

  /**
   * The open conflict queue (PRD §17, docs/09 §3).
   *
   * Ordered by impact, not by age. The queue will be long, and an admin needs
   * to know which conflicts are blocking real searches and which concern a part
   * nobody is looking for — without that, the queue is worked in an order that
   * has nothing to do with what it costs.
   */
  async conflicts(limit = 50) {
    return this.db.query(
      `SELECT fc.id, fc.status, fc.created_at, fc.claimed_verdict, fc.provider_verdict,
              fc.provider_name,
              p.id AS product_id, p.name AS product_name,
              b.name AS brand_name,
              (SELECT pi.value FROM product_identifiers pi
                WHERE pi.product_id = p.id AND pi.kind = 'OEM'
                ORDER BY pi.is_primary DESC LIMIT 1) AS oem,
              pa.display_name AS partner_name,
              concat_ws(' ', c.make, c.model, c.model_year) AS vehicle,
              c.engine_code, c.market,
              (SELECT count(*) FROM fitment_checks fch
                WHERE fch.product_id = p.id
                  AND fch.created_at > now() - interval '7 days') AS checks_last_week,
              (SELECT count(*) FROM offers o
                WHERE o.product_id = p.id AND o.active) AS offers_affected
       FROM fitment_conflicts fc
       JOIN products p ON p.id = fc.product_id
       JOIN brands b ON b.id = p.brand_id
       LEFT JOIN partners pa ON pa.id = fc.partner_id
       LEFT JOIN vehicle_configurations c ON c.id = fc.configuration_id
       WHERE fc.status = 'OPEN'
       ORDER BY checks_last_week DESC, fc.created_at
       LIMIT $1`,
      [limit],
    );
  }

  async resolveConflict(
    principal: Principal,
    conflictId: string,
    input: { action: ConflictAction; note?: string; criteria?: Record<string, unknown> },
  ) {
    const [conflict] = await this.db.query<{
      id: string; product_id: string; partner_id: string | null;
      configuration_id: string | null; status: string;
    }>(
      `SELECT id, product_id, partner_id, configuration_id, status
       FROM fitment_conflicts WHERE id = $1`,
      [conflictId],
    );
    if (!conflict) throw errors.notFound('Conflict');
    if (conflict.status !== 'OPEN') {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: 'This conflict has already been resolved.',
        messageKey: 'error.conflict.alreadyResolved',
      });
    }

    switch (input.action) {
      case 'approve':
      case 'map': {
        const criteria = input.action === 'map' ? (input.criteria ?? {}) : {};
        const [config] = conflict.configuration_id
          ? await this.db.query<Record<string, string | number | null>>(
              `SELECT make, model, model_year, generation, engine_code, transmission,
                      drive_type, body_type, trim, market
               FROM vehicle_configurations WHERE id = $1`,
              [conflict.configuration_id],
            )
          : [];

        // An admin decision becomes a first-class fitment record at the top of
        // the priority order, attributed to whoever made it (docs/05 §3.1).
        await this.db.query(
          `INSERT INTO fitments
             (product_id, source, make, model, year_from, year_to, generation,
              engine_code, transmission, drive_type, body_type, trim, market,
              verdict, confidence, active, created_by)
           VALUES ($1, 'ADMIN_MANUAL'::fitment_source, $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                   'COMPATIBLE'::fitment_verdict, 1.0, true, $13)`,
          [
            conflict.product_id,
            criteria['make'] ?? config?.['make'] ?? 'UNKNOWN',
            criteria['model'] ?? config?.['model'] ?? null,
            criteria['yearFrom'] ?? (config?.['model_year'] ? Number(config['model_year']) - 2 : null),
            criteria['yearTo'] ?? (config?.['model_year'] ? Number(config['model_year']) + 2 : null),
            criteria['generation'] ?? config?.['generation'] ?? null,
            criteria['engineCode'] ?? config?.['engine_code'] ?? null,
            criteria['transmission'] ?? null,
            criteria['driveType'] ?? null,
            criteria['bodyType'] ?? null,
            criteria['trim'] ?? null,
            criteria['market'] ?? config?.['market'] ?? null,
            principal.userId,
          ],
        );
        break;
      }

      case 'reject':
        // The partner's claim is retired, so the product stays hidden for this
        // vehicle and the conflict does not reopen on the next search.
        await this.db.query(
          `UPDATE fitments SET active = false, updated_at = now()
           WHERE product_id = $1 AND source = 'PARTNER_DECLARED'
             AND partner_id IS NOT DISTINCT FROM $2`,
          [conflict.product_id, conflict.partner_id],
        );
        break;

      case 'investigate':
        await this.db.query(
          `UPDATE fitment_conflicts SET resolution_note = $2 WHERE id = $1`,
          [conflictId, input.note ?? null],
        );
        await this.audit.record({
          actor: principal, action: 'FITMENT_CHANGE', entityType: 'fitment_conflict',
          entityId: conflictId, after: { action: 'investigate', note: input.note },
        });
        return { status: 'OPEN' };
    }

    const status =
      input.action === 'approve' ? 'APPROVED' : input.action === 'map' ? 'MAPPED' : 'REJECTED';

    await this.db.query(
      `UPDATE fitment_conflicts
       SET status = $2::conflict_status, resolution_note = $3,
           resolved_by = $4, resolved_at = now()
       WHERE id = $1`,
      [conflictId, status, input.note ?? null, principal.userId],
    );

    await this.audit.record({
      actor: principal, action: 'FITMENT_CHANGE', entityType: 'fitment_conflict',
      entityId: conflictId, after: { action: input.action, status },
      partnerId: conflict.partner_id,
    });

    return { status };
  }

  /* ───────────────────────── partners ───────────────────────── */

  async partners(status?: string) {
    return this.db.query(
      `SELECT p.id, p.legal_name, p.display_name, p.status, p.integration_mode,
              p.stock_reliability, p.created_at, p.approved_at,
              (SELECT count(*) FROM partner_locations l
                WHERE l.partner_id = p.id AND l.active) AS locations,
              (SELECT count(*) FROM offers o WHERE o.partner_id = p.id AND o.active) AS offers,
              (SELECT count(*) FROM partner_orders po WHERE po.partner_id = p.id) AS orders,
              (SELECT count(*) FROM fitment_conflicts fc
                WHERE fc.partner_id = p.id AND fc.status = 'OPEN') AS open_conflicts
       FROM partners p
       WHERE ($1::text IS NULL OR p.status::text = $1)
       ORDER BY
         CASE WHEN p.status = 'PENDING' THEN 0 ELSE 1 END,
         p.created_at DESC`,
      [status ?? null],
    );
  }

  async setPartnerStatus(principal: Principal, partnerId: string, status: string) {
    const [before] = await this.db.query<{ status: string }>(
      `SELECT status FROM partners WHERE id = $1`,
      [partnerId],
    );
    if (!before) throw errors.notFound('Partner');

    await this.db.query(
      `UPDATE partners
       SET status = $2::partner_status,
           approved_at = CASE WHEN $2 = 'APPROVED' THEN COALESCE(approved_at, now()) ELSE approved_at END,
           suspended_at = CASE WHEN $2 = 'SUSPENDED' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $1`,
      [partnerId, status],
    );

    await this.audit.record({
      actor: principal, action: 'PARTNER_ACTION', entityType: 'partner',
      entityId: partnerId, before, after: { status }, partnerId,
    });

    // Suspension hides the offers immediately; orders already placed are left
    // alone, because cancelling someone's paid order is a separate decision
    // that deserves to be made deliberately (docs/09 §4.2).
    return { status };
  }

  /* ───────────────────────── pricing ───────────────────────── */

  async priceRules() {
    return this.db.query(
      `SELECT pr.id, pr.markup_percent, pr.markup_fixed_minor::text, pr.priority, pr.active,
              pr.valid_from, pr.valid_to,
              pa.display_name AS partner_name, c.slug AS category_slug,
              u.email AS created_by_email
       FROM price_rules pr
       LEFT JOIN partners pa ON pa.id = pr.partner_id
       LEFT JOIN categories c ON c.id = pr.category_id
       LEFT JOIN users u ON u.id = pr.created_by
       ORDER BY pr.priority DESC, pr.created_at DESC`,
    );
  }

  /**
   * Preview before changing a markup (docs/09 §7).
   *
   * A markup change moves real prices, so the admin sees how many offers it
   * touches and by how much before committing. A number that only becomes
   * visible afterwards is a number nobody checks.
   */
  async previewMarkup(input: { partnerId?: string; categoryId?: string; markupPercent: number }) {
    const [row] = await this.db.query<{
      affected: string; current_avg: string | null; new_avg: string | null;
    }>(
      `SELECT count(*)::text AS affected,
              round(avg(o.customer_price_minor))::text AS current_avg,
              round(avg(o.base_price_minor * (1 + $3::numeric / 100)))::text AS new_avg
       FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       WHERE o.active
         AND ($1::uuid IS NULL OR o.partner_id = $1)
         AND ($2::uuid IS NULL OR mp.category_id = $2)`,
      [input.partnerId ?? null, input.categoryId ?? null, input.markupPercent],
    );

    const current = Number(row?.current_avg ?? 0);
    const next = Number(row?.new_avg ?? 0);

    return {
      affectedOffers: Number(row?.affected ?? 0),
      currentAverageMinor: row?.current_avg ?? '0',
      newAverageMinor: row?.new_avg ?? '0',
      changePercent: current === 0 ? 0 : Math.round(((next - current) / current) * 1000) / 10,
    };
  }

  async upsertPriceRule(
    principal: Principal,
    input: {
      id?: string; partnerId?: string | null; categoryId?: string | null;
      markupPercent?: number | null; markupFixedMinor?: string | null;
      priority?: number; active?: boolean;
    },
  ) {
    const [row] = input.id
      ? await this.db.query<{ id: string }>(
          `UPDATE price_rules
           SET markup_percent = COALESCE($2, markup_percent),
               markup_fixed_minor = COALESCE($3::bigint, markup_fixed_minor),
               priority = COALESCE($4, priority),
               active = COALESCE($5, active)
           WHERE id = $1 RETURNING id`,
          [input.id, input.markupPercent ?? null, input.markupFixedMinor ?? null,
           input.priority ?? null, input.active ?? null],
        )
      : await this.db.query<{ id: string }>(
          `INSERT INTO price_rules
             (partner_id, category_id, markup_percent, markup_fixed_minor,
              currency, priority, active, created_by)
           VALUES ($1,$2,$3,$4::bigint,'GEL',$5,true,$6) RETURNING id`,
          [input.partnerId ?? null, input.categoryId ?? null, input.markupPercent ?? null,
           input.markupFixedMinor ?? null, input.priority ?? 0, principal.userId],
        );

    // Dropped immediately rather than waiting out the cache TTL, so an admin
    // sees the effect of their own change.
    this.pricing.invalidate();

    await this.audit.record({
      actor: principal, action: 'COMMISSION_CHANGE', entityType: 'price_rule',
      entityId: row?.id ?? null, after: input,
      partnerId: input.partnerId ?? null,
    });

    return row;
  }

  /* ───────────────────────── orders and money ───────────────────────── */

  async orders(filter: { status?: string; partnerId?: string; limit?: number }) {
    return this.db.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status,
              o.total_minor::text, o.currency, o.created_at,
              u.email AS customer_email, pa.display_name AS partner_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN partner_orders po ON po.order_id = o.id
       LEFT JOIN partners pa ON pa.id = po.partner_id
       WHERE ($1::text IS NULL OR o.status::text = $1)
         AND ($2::uuid IS NULL OR po.partner_id = $2)
       ORDER BY o.created_at DESC
       LIMIT $3`,
      [filter.status ?? null, filter.partnerId ?? null, Math.min(filter.limit ?? 50, 200)],
    );
  }

  async refundOrder(principal: Principal, orderId: string, amountMinor?: string) {
    const [order] = await this.db.query<{
      id: string; total_minor: string; currency: string;
      payment_id: string | null; transaction_id: string | null; refunded: string;
    }>(
      `SELECT o.id, o.total_minor::text, o.currency,
              p.id AS payment_id, p.provider_transaction_id AS transaction_id,
              COALESCE((SELECT sum(r.amount_minor) FROM refunds r
                        WHERE r.order_id = o.id AND r.status = 'REFUNDED'), 0)::text AS refunded
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
       WHERE o.id = $1`,
      [orderId],
    );
    if (!order) throw errors.notFound('Order');
    if (!order.payment_id || !order.transaction_id) {
      throw new AppError({
        code: ErrorCode.CONFLICT, status: 409,
        message: 'This order has no captured payment to refund.',
        messageKey: 'error.refund.noPayment',
      });
    }

    const requested = amountMinor ? BigInt(amountMinor) : BigInt(order.total_minor);
    const alreadyRefunded = BigInt(order.refunded);

    // Invariant I4, checked before the provider is called rather than after.
    if (alreadyRefunded + requested > BigInt(order.total_minor)) {
      throw new AppError({
        code: ErrorCode.CONFLICT, status: 409,
        message: 'That would refund more than was charged.',
        messageKey: 'error.refund.exceedsCharged',
        details: {
          chargedMinor: order.total_minor,
          alreadyRefundedMinor: order.refunded,
          requestedMinor: requested.toString(),
        },
      });
    }

    await this.ordersService.refund(orderId, order.payment_id, order.transaction_id, {
      amountMinor: requested,
      currency: order.currency,
      reason: 'ADMIN',
      initiatedBy: principal.userId,
    });

    await this.audit.record({
      actor: principal, action: 'REFUND', entityType: 'order', entityId: orderId,
      after: { amountMinor: requested.toString(), reason: 'ADMIN' },
    });

    return { refundedMinor: requested.toString() };
  }

  /* ───────────────────────── users ───────────────────────── */

  async users(filter: { search?: string; limit?: number }) {
    return this.db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.locale, u.created_at,
              u.suspended_at, u.last_login_at,
              (SELECT array_agg(ur.role::text) FROM user_roles ur WHERE ur.user_id = u.id) AS roles,
              (SELECT count(*) FROM vehicles v
                WHERE v.user_id = u.id AND v.deleted_at IS NULL) AS vehicles,
              (SELECT count(*) FROM orders o WHERE o.user_id = u.id) AS orders
       FROM users u
       WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%')
       ORDER BY u.created_at DESC
       LIMIT $2`,
      [filter.search ?? null, Math.min(filter.limit ?? 50, 200)],
    );
  }

  async setUserSuspended(principal: Principal, userId: string, suspended: boolean) {
    await this.db.query(
      `UPDATE users SET suspended_at = $2, updated_at = now() WHERE id = $1`,
      [userId, suspended ? new Date() : null],
    );
    await this.audit.record({
      actor: principal, action: 'USER_ACTION', entityType: 'user',
      entityId: userId, after: { suspended },
    });
    return { suspended };
  }

  /* ───────────────────────── analytics ───────────────────────── */

  /**
   * The funnel of PRD §60 and the KPIs of §61.
   *
   * Fitment Accuracy and Inventory Accuracy come first because they are the
   * product's first and second priorities — a dashboard that buries them under
   * revenue teaches the wrong thing about what matters.
   */
  async analytics() {
    const [funnel] = await this.db.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM users)::text AS registered,
         (SELECT count(DISTINCT user_id) FROM vehicles WHERE deleted_at IS NULL)::text AS added_vehicle,
         (SELECT count(DISTINCT vehicle_id) FROM fitment_checks WHERE vehicle_id IS NOT NULL)::text AS searched,
         (SELECT count(DISTINCT vehicle_id) FROM fitment_checks
           WHERE vehicle_id IS NOT NULL
             AND verdict::text IN ('EXACT','COMPATIBLE','CONDITIONAL'))::text AS found_compatible,
         (SELECT count(DISTINCT user_id) FROM cart_items ci
           JOIN carts c ON c.id = ci.cart_id)::text AS carted,
         (SELECT count(*) FROM orders)::text AS checkout,
         (SELECT count(*) FROM orders WHERE payment_status = 'CAPTURED')::text AS paid,
         (SELECT count(*) FROM orders WHERE status = 'COMPLETED')::text AS completed`,
    );

    const [kpi] = await this.db.query<Record<string, string | null>>(
      `SELECT
         (SELECT count(*) FROM fitment_checks)::text AS fitment_checks,
         (SELECT count(*) FROM fitment_checks WHERE was_correct = false)::text AS fitment_wrong,
         (SELECT count(*) FROM inventory_checks)::text AS inventory_checks,
         (SELECT count(*) FROM inventory_checks WHERE matched = false)::text AS inventory_wrong,
         (SELECT COALESCE(sum(total_minor), 0) FROM orders
           WHERE status = 'COMPLETED')::text AS gmv_minor,
         (SELECT COALESCE(sum(markup_minor), 0) FROM orders
           WHERE status = 'COMPLETED')::text AS revenue_minor,
         (SELECT count(*) FROM orders WHERE payment_status = 'REFUNDED')::text AS refunded,
         (SELECT count(*) FROM fitment_conflicts WHERE status = 'OPEN')::text AS open_conflicts`,
    );

    const n = (v: string | null | undefined) => Number(v ?? 0);
    const rate = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);

    const fitmentChecks = n(kpi?.['fitment_checks']);
    const inventoryChecks = n(kpi?.['inventory_checks']);
    const gmv = n(kpi?.['gmv_minor']);
    const revenue = n(kpi?.['revenue_minor']);
    const paid = n(funnel?.['paid']);

    return {
      funnel: {
        registered: n(funnel?.['registered']),
        addedVehicle: n(funnel?.['added_vehicle']),
        searched: n(funnel?.['searched']),
        foundCompatible: n(funnel?.['found_compatible']),
        carted: n(funnel?.['carted']),
        checkout: n(funnel?.['checkout']),
        paid,
        completed: n(funnel?.['completed']),
      },
      kpis: {
        vehicleActivationRate: rate(n(funnel?.['added_vehicle']), n(funnel?.['registered'])),
        searchToOfferRate: rate(n(funnel?.['found_compatible']), n(funnel?.['searched'])),
        offerToPurchaseRate: rate(paid, n(funnel?.['carted'])),
        // Correctness is only known for checks a return or dispute told us
        // about; the rest are assumed right, which is why the denominator is
        // every check rather than only the judged ones.
        fitmentAccuracy:
          fitmentChecks === 0
            ? null
            : Math.round(((fitmentChecks - n(kpi?.['fitment_wrong'])) / fitmentChecks) * 1000) / 10,
        inventoryAccuracy:
          inventoryChecks === 0
            ? null
            : Math.round(((inventoryChecks - n(kpi?.['inventory_wrong'])) / inventoryChecks) * 1000) / 10,
        gmvMinor: kpi?.['gmv_minor'] ?? '0',
        revenueMinor: kpi?.['revenue_minor'] ?? '0',
        takeRate: gmv === 0 ? null : Math.round((revenue / gmv) * 1000) / 10,
        orderSuccessRate: rate(n(funnel?.['completed']), paid),
        refundRate: rate(n(kpi?.['refunded']), paid),
      },
      alerts: {
        openFitmentConflicts: n(kpi?.['open_conflicts']),
      },
    };
  }

  /** Marks a fitment decision as wrong, which is what feeds the accuracy KPI. */
  async reportFitmentDispute(principal: Principal, orderItemId: string, note?: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE fitment_checks SET was_correct = false
       WHERE id = (SELECT fitment_check_id FROM order_items WHERE id = $1)
       RETURNING id`,
      [orderItemId],
    );
    if (rows.length === 0) {
      // Not every order line has a recorded check yet; say so rather than
      // pretending the dispute was filed.
      throw errors.notFound('Fitment check for this order item');
    }

    await this.audit.record({
      actor: principal, action: 'FITMENT_CHANGE', entityType: 'order_item',
      entityId: orderItemId, after: { wasCorrect: false, note },
    });

    return { recorded: true };
  }

  async reindexSearch(principal: Principal) {
    const documents = await this.search.reindex();
    await this.audit.record({
      actor: principal, action: 'ADMIN_ACTION', entityType: 'search_index',
      after: { documents },
    });
    return { documents };
  }
}
