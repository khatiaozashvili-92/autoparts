import { Injectable } from '@nestjs/common';
import { errors, resolvePartnerScope, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';

/**
 * Money in and money out, for whoever is asking (PRD §79, docs/08 §7).
 *
 * One query shape, three audiences, and the difference between them is a
 * WHERE clause — not three separate reports that drift apart. A customer sees
 * what they paid and what came back; a partner sees the same events for their
 * own orders; platform staff see everything.
 *
 * Payments and refunds are separate tables because they are separate events
 * with separate provider identifiers, but to anybody reading a history they
 * are one list in time order. So they are unioned here rather than in the UI,
 * which also means the three audiences cannot disagree about what happened.
 */

export type TransactionScope =
  | { kind: 'customer'; userId: string }
  | { kind: 'partner'; partnerId: string }
  | { kind: 'platform' };

export interface TransactionRow {
  id: string;
  kind: 'PAYMENT' | 'REFUND';
  at: string;
  order_id: string;
  order_number: string;
  /** Negative for a refund, so a column of these sums to the real total. */
  amount_minor: string;
  currency: string;
  status: string;
  /** What the platform kept. Null on rows the viewer may not see it for. */
  commission_minor: string | null;
  reason: string | null;
  partner: string | null;
  customer_phone: string | null;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Decides what this principal is allowed to see, from the token alone.
   *
   * Never from a parameter: a customer id or partner id in a query string
   * would let anyone read anyone's money (docs/07 §5.1).
   */
  scopeFor(principal: Principal, isPlatformStaff: boolean): TransactionScope {
    if (isPlatformStaff) return { kind: 'platform' };

    // `resolvePartnerScope` throws for anyone who is neither staff nor a
    // partner — correct where it guards a partner-only route, wrong here,
    // where an ordinary customer asking for their own receipts is the most
    // common case of all. So the partner branch is only entered by someone
    // who actually carries a partner in their token.
    if (principal.partnerId) {
      return { kind: 'partner', partnerId: resolvePartnerScope(principal)! };
    }

    return { kind: 'customer', userId: principal.userId };
  }

  async list(scope: TransactionScope, filter: { limit?: number; from?: string; to?: string } = {}) {
    const limit = Math.min(filter.limit ?? 100, 500);
    const from = filter.from ?? null;
    const to = filter.to ?? null;

    // $1 customer, $2 partner, $3 platform — exactly one is ever set, and the
    // others are null, so the planner sees a straightforward filter.
    const customerId = scope.kind === 'customer' ? scope.userId : null;
    const partnerId = scope.kind === 'partner' ? scope.partnerId : null;
    const isPlatform = scope.kind === 'platform';

    // A partner never sees the platform's commission, and a customer never
    // sees it either — to them there is one price, which is the whole point of
    // how the marketplace quotes (docs/08 §3).
    const commission = isPlatform ? 'p.commission_minor::text' : 'NULL';

    return this.db.query<TransactionRow>(
      `WITH visible_orders AS (
         SELECT DISTINCT o.id
         FROM orders o
         LEFT JOIN partner_orders po ON po.order_id = o.id
         WHERE ($1::uuid IS NULL OR o.user_id = $1)
           AND ($2::uuid IS NULL OR po.partner_id = $2)
           AND ($3::boolean OR $1::uuid IS NOT NULL OR $2::uuid IS NOT NULL)
       )
       SELECT * FROM (
         SELECT
           p.id,
           'PAYMENT' AS kind,
           COALESCE(p.captured_at, p.authorized_at, p.created_at) AS at,
           o.id AS order_id,
           o.order_number,
           p.amount_minor::text AS amount_minor,
           p.currency,
           p.status::text AS status,
           ${commission} AS commission_minor,
           NULL AS reason,
           pa.display_name AS partner,
           u.phone AS customer_phone
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         JOIN visible_orders v ON v.id = o.id
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN partner_orders po2 ON po2.order_id = o.id
         LEFT JOIN partners pa ON pa.id = po2.partner_id

         UNION ALL

         SELECT
           r.id,
           'REFUND' AS kind,
           COALESCE(r.completed_at, r.created_at) AS at,
           o.id AS order_id,
           o.order_number,
           -- Negative, so a column of these sums to what actually changed hands.
           ('-' || r.amount_minor::text) AS amount_minor,
           r.currency,
           r.status::text AS status,
           NULL AS commission_minor,
           r.reason,
           pa.display_name AS partner,
           u.phone AS customer_phone
         FROM refunds r
         JOIN orders o ON o.id = r.order_id
         JOIN visible_orders v ON v.id = o.id
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN partner_orders po2 ON po2.order_id = o.id
         LEFT JOIN partners pa ON pa.id = po2.partner_id
       ) t
       WHERE ($4::date IS NULL OR t.at >= $4::date)
         AND ($5::date IS NULL OR t.at < ($5::date + interval '1 day'))
       ORDER BY t.at DESC
       LIMIT $6`,
      [customerId, partnerId, isPlatform, from, to, limit],
    );
  }

  /** The totals that belong above the list. */
  async summary(scope: TransactionScope, filter: { from?: string; to?: string } = {}) {
    const rows = await this.list(scope, { ...filter, limit: 500 });

    let paid = 0n;
    let refunded = 0n;
    let commission = 0n;
    for (const row of rows) {
      const amount = BigInt(row.amount_minor);
      if (row.kind === 'PAYMENT') {
        // Only money that actually moved. An authorised-but-not-captured
        // payment is a promise, and counting it as revenue would overstate
        // every total on the page.
        if (row.status === 'CAPTURED' || row.status === 'REFUNDED') paid += amount;
      } else if (row.status === 'REFUNDED') {
        refunded += -amount;
      }
      if (row.commission_minor) commission += BigInt(row.commission_minor);
    }

    return {
      transactions: rows.length,
      paidMinor: paid.toString(),
      refundedMinor: refunded.toString(),
      netMinor: (paid - refunded).toString(),
      ...(scope.kind === 'platform' ? { commissionMinor: commission.toString() } : {}),
    };
  }

  /** Guards a customer reading somebody else's order, for the detail view. */
  async assertVisible(scope: TransactionScope, orderId: string): Promise<void> {
    if (scope.kind === 'platform') return;
    const [row] = await this.db.query<{ id: string }>(
      scope.kind === 'customer'
        ? `SELECT id FROM orders WHERE id = $1 AND user_id = $2`
        : `SELECT o.id FROM orders o
           JOIN partner_orders po ON po.order_id = o.id
           WHERE o.id = $1 AND po.partner_id = $2`,
      [orderId, scope.kind === 'customer' ? scope.userId : scope.partnerId],
    );
    if (!row) throw errors.notFound('Order');
  }
}
