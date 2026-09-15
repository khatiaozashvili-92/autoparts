import { Injectable } from '@nestjs/common';
import { errors, resolvePartnerScope, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { PricingService } from '../pricing/pricing.service.js';

export interface PartnerOfferRow {
  id: string;
  productId: string;
  productName: string;
  brandName: string;
  oem: string | null;
  partnerSku: string | null;
  basePriceMinor: string;
  /** What the buyer pays. Shown so the partner knows the shelf price… */
  customerPriceMinor: string;
  /** …but never the platform's cut, which is a commercial term (docs/08 §2). */
  currency: string;
  stockQuantity: number;
  availabilityStatus: string;
  locationName: string | null;
  lastSyncedAt: string;
  stockAgeMinutes: number;
  isStale: boolean;
  active: boolean;
}

@Injectable()
export class PartnersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * The partner this principal may act for.
   *
   * Taken from the token, never from the request. A partnerId in a body or
   * query string is ignored, which is what makes cross-partner access
   * impossible rather than merely discouraged (docs/07 §5.1).
   */
  scopeOf(principal: Principal): string {
    const scope = resolvePartnerScope(principal);
    if (scope === null) throw errors.notFound('Partner');
    return scope;
  }

  async profile(partnerId: string) {
    const [row] = await this.db.query<{
      id: string; legal_name: string; display_name: string; status: string;
      integration_mode: string; country: string; currency: string;
      contact_email: string | null; contact_phone: string | null;
      stock_reliability: string; approved_at: Date | null;
    }>(
      `SELECT id, legal_name, display_name, status, integration_mode, country, currency,
              contact_email, contact_phone, stock_reliability, approved_at
       FROM partners WHERE id = $1`,
      [partnerId],
    );
    if (!row) throw errors.notFound('Partner');

    return {
      id: row.id,
      legalName: row.legal_name,
      displayName: row.display_name,
      status: row.status,
      integrationMode: row.integration_mode,
      country: row.country,
      currency: row.currency,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      // Shown to the partner on purpose: it drives Recommended ranking, and a
      // number nobody can see is a number nobody improves (docs/10 §9).
      stockReliability: Number(row.stock_reliability),
      approvedAt: row.approved_at?.toISOString() ?? null,
    };
  }

  /**
   * Onboarding checklist (docs/06 §12).
   *
   * Offers do not go live until each item is done. The partner sees which one
   * is blocking them, rather than an opaque "pending".
   */
  async onboarding(partnerId: string) {
    const [row] = await this.db.query<{
      approved: boolean;
      locations: string;
      offers: string;
      open_conflicts: string;
    }>(
      `SELECT (p.status = 'APPROVED') AS approved,
              (SELECT count(*) FROM partner_locations l
                WHERE l.partner_id = p.id AND l.active)::text AS locations,
              (SELECT count(*) FROM offers o
                WHERE o.partner_id = p.id AND o.active)::text AS offers,
              (SELECT count(*) FROM fitment_conflicts fc
                WHERE fc.partner_id = p.id AND fc.status = 'OPEN')::text AS open_conflicts
       FROM partners p WHERE p.id = $1`,
      [partnerId],
    );
    if (!row) throw errors.notFound('Partner');

    const steps = [
      { key: 'approved', done: row.approved, detail: null as string | null },
      {
        key: 'location',
        done: Number(row.locations) > 0,
        detail: 'At least one pickup location is required',
      },
      { key: 'inventory', done: Number(row.offers) > 0, detail: 'No products uploaded yet' },
      {
        key: 'conflicts',
        done: Number(row.open_conflicts) === 0,
        detail: `${row.open_conflicts} fitment conflicts are hiding your products`,
      },
    ];

    return {
      live: steps.every((s) => s.done),
      steps,
      counts: {
        locations: Number(row.locations),
        offers: Number(row.offers),
        openConflicts: Number(row.open_conflicts),
      },
    };
  }

  async dashboard(partnerId: string) {
    const [row] = await this.db.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM partner_orders WHERE partner_id = $1
           AND status IN ('CONFIRMED','PAID'))::text AS new_orders,
         (SELECT count(*) FROM partner_orders WHERE partner_id = $1
           AND status = 'PREPARING')::text AS preparing,
         (SELECT count(*) FROM partner_orders WHERE partner_id = $1
           AND status = 'READY_FOR_PICKUP')::text AS ready,
         (SELECT COALESCE(sum(subtotal_minor), 0) FROM partner_orders
           WHERE partner_id = $1 AND status IN ('COMPLETED','PICKED_UP')
             AND created_at >= date_trunc('day', now()))::text AS revenue_today_minor,
         (SELECT count(*) FROM offers WHERE partner_id = $1 AND active
           AND stock_quantity = 0)::text AS out_of_stock,
         (SELECT count(*) FROM offers WHERE partner_id = $1 AND active)::text AS total_offers,
         (SELECT extract(epoch FROM (now() - max(last_synced_at)))::int / 60
          FROM offers WHERE partner_id = $1 AND active)::text AS minutes_since_sync`,
      [partnerId],
    );

    return {
      newOrders: Number(row?.['new_orders'] ?? 0),
      preparing: Number(row?.['preparing'] ?? 0),
      readyForPickup: Number(row?.['ready'] ?? 0),
      revenueTodayMinor: row?.['revenue_today_minor'] ?? '0',
      outOfStock: Number(row?.['out_of_stock'] ?? 0),
      totalOffers: Number(row?.['total_offers'] ?? 0),
      // Always surfaced: stale stock is how Inventory Accuracy dies, and the
      // partner is the only one who can fix it (docs/10 §3).
      minutesSinceSync: row?.['minutes_since_sync'] === null ? null : Number(row?.['minutes_since_sync'] ?? 0),
    };
  }

  async offers(partnerId: string, opts: { limit?: number; search?: string } = {}) {
    const rows = await this.db.query<{
      id: string; product_id: string; product_name: string; brand_name: string;
      oem: string | null; partner_sku: string | null;
      base_price_minor: string; customer_price_minor: string; currency: string;
      stock_quantity: number; availability_status: string;
      location_name: string | null; last_synced_at: Date;
      stock_age_minutes: number; is_stale: boolean; active: boolean;
    }>(
      `SELECT o.id, o.product_id, p.name AS product_name, b.name AS brand_name,
              (SELECT pi.value FROM product_identifiers pi
                WHERE pi.product_id = p.id AND pi.kind = 'OEM'
                ORDER BY pi.is_primary DESC LIMIT 1) AS oem,
              o.partner_sku, o.base_price_minor::text, o.customer_price_minor::text,
              o.currency, o.stock_quantity, o.availability_status,
              l.name AS location_name, o.last_synced_at,
              (extract(epoch FROM (now() - o.last_synced_at))::int / 60) AS stock_age_minutes,
              o.is_stale, o.active
       FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN brands b ON b.id = p.brand_id
       LEFT JOIN partner_locations l ON l.id = o.location_id
       WHERE o.partner_id = $1
         AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%' OR o.partner_sku ILIKE '%' || $2 || '%')
       ORDER BY o.updated_at DESC
       LIMIT $3`,
      [partnerId, opts.search ?? null, Math.min(opts.limit ?? 50, 200)],
    );

    return rows.map<PartnerOfferRow>((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      brandName: r.brand_name,
      oem: r.oem,
      partnerSku: r.partner_sku,
      basePriceMinor: r.base_price_minor,
      customerPriceMinor: r.customer_price_minor,
      currency: r.currency,
      stockQuantity: r.stock_quantity,
      availabilityStatus: r.availability_status,
      locationName: r.location_name,
      lastSyncedAt: r.last_synced_at.toISOString(),
      stockAgeMinutes: r.stock_age_minutes,
      isStale: r.is_stale,
      active: r.active,
    }));
  }

  async updateOffer(
    partnerId: string,
    offerId: string,
    input: { basePriceMinor?: string; stockQuantity?: number; availabilityStatus?: string; active?: boolean },
  ) {
    const [existing] = await this.db.query<{ product_id: string; category_id: string }>(
      `SELECT o.product_id, mp.category_id
       FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       WHERE o.id = $1 AND o.partner_id = $2`,
      [offerId, partnerId],
    );
    if (!existing) throw errors.notFound('Offer');

    // Markup is recomputed whenever the base price moves, so the two can never
    // drift apart.
    let markupMinor: string | null = null;
    if (input.basePriceMinor !== undefined) {
      const markup = await this.pricing.computeMarkupMinor(BigInt(input.basePriceMinor), {
        partnerId,
        categoryId: existing.category_id,
      });
      markupMinor = markup.toString();
    }

    await this.db.query(
      `UPDATE offers
       SET base_price_minor = COALESCE($3::bigint, base_price_minor),
           platform_markup_minor = COALESCE($4::bigint, platform_markup_minor),
           stock_quantity = COALESCE($5::int, stock_quantity),
           availability_status = COALESCE($6::availability_status, availability_status),
           active = COALESCE($7::boolean, active),
           last_synced_at = now(),
           is_stale = false,
           updated_at = now()
       WHERE id = $1 AND partner_id = $2`,
      [
        offerId,
        partnerId,
        input.basePriceMinor ?? null,
        markupMinor,
        input.stockQuantity ?? null,
        input.availabilityStatus ?? null,
        input.active ?? null,
      ],
    );

    const [updated] = await this.offers(partnerId, { limit: 1, search: undefined });
    return updated ?? null;
  }

  async locations(partnerId: string) {
    return this.db.query(
      `SELECT id, name, address_line, city, country, latitude, longitude,
              working_hours, pickup_instructions, phone, active
       FROM partner_locations WHERE partner_id = $1 ORDER BY created_at`,
      [partnerId],
    );
  }

  async addLocation(
    partnerId: string,
    input: {
      name: string; addressLine: string; city: string; country?: string;
      latitude?: number; longitude?: number; phone?: string; pickupInstructions?: string;
    },
  ) {
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO partner_locations
         (partner_id, name, address_line, city, country, latitude, longitude,
          phone, pickup_instructions, active)
       VALUES ($1,$2,$3,$4,COALESCE($5,'GE'),$6,$7,$8,$9,true)
       RETURNING id`,
      [
        partnerId, input.name, input.addressLine, input.city, input.country ?? null,
        input.latitude ?? null, input.longitude ?? null,
        input.phone ?? null, input.pickupInstructions ?? null,
      ],
    );
    return row;
  }

  /** Fitment conflicts hiding this partner's products (docs/10 §9). */
  async conflicts(partnerId: string) {
    return this.db.query(
      `SELECT fc.id, fc.status, fc.created_at,
              p.name AS product_name,
              c.make, c.model, c.model_year
       FROM fitment_conflicts fc
       JOIN products p ON p.id = fc.product_id
       LEFT JOIN vehicle_configurations c ON c.id = fc.configuration_id
       WHERE fc.partner_id = $1 AND fc.status = 'OPEN'
       ORDER BY fc.created_at DESC
       LIMIT 100`,
      [partnerId],
    );
  }
}
