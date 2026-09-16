import { Injectable } from '@nestjs/common';
import {
  AppError,
  ErrorCode,
  errors,
  normalizeIdentifier,
  resolvePartnerScope,
  type Principal,
} from '@autoparts/core';
import { DatabaseService, type TransactionClient } from '../../database/database.module.js';
import { PricingService } from '../pricing/pricing.service.js';

/**
 * What a partner may add to the catalogue, and what it may sell (docs/10 §3).
 *
 * A partner owns its prices, its stock and its own products. It does not own
 * the shape of the catalogue: categories and the vehicle attributes a category
 * needs are the platform's, because those are what the Fitment Engine reads.
 *
 * Every query here is scoped through `resolvePartnerScope`, which takes the
 * partner from the token and never from the request — the rule that makes a
 * cross-partner read impossible rather than merely discouraged (docs/07 §5.1).
 */

export interface CreateProductInput {
  categorySlug: string;
  /** Free text; matched to an existing master part or a new one is created. */
  partName: string;
  brandName: string;
  productName: string;
  /** OEM and aftermarket numbers. Without at least one nothing can match it. */
  identifiers: { kind: 'OEM' | 'MPN' | 'EAN'; value: string }[];
  description?: string;
  warrantyMonths?: number;
  /** The partner's own price and stock, so one call is enough to start selling. */
  priceMinor: string;
  stockQuantity: number;
  partnerSku?: string;
  locationId?: string;
}

@Injectable()
export class PartnerCatalogueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Adds a product the platform does not list yet, with the partner's price
   * and stock attached.
   *
   * The product is created inert: `approved_at` stays null and `active` false,
   * so no customer can be shown it. That is not bureaucracy — a part nobody
   * has established fitment for cannot be matched to a car, and showing it
   * would break the one promise the product makes (ADR-004, docs/05 §1). It
   * goes to the admin review queue, and the partner can price and stock it
   * meanwhile.
   */
  async createProduct(principal: Principal, input: CreateProductInput) {
    const partnerId = resolvePartnerScope(principal);
    if (!partnerId) throw errors.notFound('Partner');

    const identifiers = input.identifiers
      .map((i) => ({ kind: i.kind, value: i.value.trim(), normalized: normalizeIdentifier(i.value) }))
      .filter((i) => i.normalized.length > 0);

    if (identifiers.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'At least one OEM or manufacturer part number is required.',
        messageKey: 'error.product.identifierRequired',
      });
    }

    return this.db.transaction(async (tx) => {
      const [category] = await tx.query<{ id: string }>(
        `SELECT id FROM categories WHERE slug = $1 AND active`,
        [input.categorySlug],
      );
      if (!category) throw errors.notFound('Category');

      // An identifier already in the catalogue means this part exists. Adding
      // a second row for it would split its fitment data in two and make the
      // same part look like two different ones to a buyer.
      const clash = await tx.query<{ product_id: string; name: string }>(
        `SELECT DISTINCT pi.product_id, p.name
         FROM product_identifiers pi
         JOIN products p ON p.id = pi.product_id
         WHERE pi.normalized = ANY($1::text[])`,
        [identifiers.map((i) => i.normalized)],
      );
      if (clash.length > 0) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          status: 409,
          message: 'This part number is already in the catalogue.',
          messageKey: 'error.product.identifierTaken',
          details: { productId: clash[0]!.product_id, name: clash[0]!.name },
        });
      }

      const brandId = await this.ensureBrand(tx, input.brandName);
      const masterPartId = await this.ensureMasterPart(tx, category.id, input.partName);

      const [product] = await tx.query<{ id: string }>(
        `INSERT INTO products (master_part_id, brand_id, name, description, warranty_months,
                               created_by_partner_id, approved_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, false)
         RETURNING id`,
        [
          masterPartId,
          brandId,
          input.productName,
          input.description ?? null,
          input.warrantyMonths ?? null,
          partnerId,
        ],
      );
      if (!product) throw errors.internal();

      for (const identifier of identifiers) {
        await tx.query(
          `INSERT INTO product_identifiers (product_id, kind, value, normalized)
           VALUES ($1, $2::identifier_kind, $3, $4)
           ON CONFLICT DO NOTHING`,
          [product.id, identifier.kind, identifier.value, identifier.normalized],
        );
      }

      const markup = await this.pricing.computeMarkupMinor(BigInt(input.priceMinor), {
        partnerId,
        categoryId: category.id,
      });

      await tx.query(
        `INSERT INTO offers (partner_id, product_id, location_id, partner_sku,
                             base_price_minor, platform_markup_minor, currency,
                             stock_quantity, availability_status, last_synced_at, active)
         VALUES ($1,$2,$3,$4,$5,$6,'GEL',$7,$8, now(), true)`,
        [
          partnerId,
          product.id,
          input.locationId ?? null,
          input.partnerSku ?? null,
          input.priceMinor,
          markup.toString(),
          input.stockQuantity,
          input.stockQuantity > 0 ? 'IN_STOCK' : 'UNAVAILABLE',
        ],
      );

      return {
        id: product.id,
        pendingReview: true,
        // Said plainly, because a partner who thinks their product is live and
        // finds no orders will conclude the marketplace is broken.
        message: 'Added. A platform admin has to confirm what it fits before buyers see it.',
      };
    });
  }

  /** Everything this partner sells, listed and pending alike. */
  async products(principal: Principal, filter: { pending?: boolean } = {}) {
    const partnerId = resolvePartnerScope(principal);
    if (!partnerId) throw errors.notFound('Partner');

    return this.db.query(
      `SELECT p.id, p.name, p.active, p.approved_at, p.created_by_partner_id IS NOT NULL AS mine,
              b.name AS brand, c.slug AS category_slug, mp.normalized_name AS master_part,
              o.id AS offer_id, o.base_price_minor, o.stock_quantity,
              o.availability_status::text AS availability, o.currency,
              o.is_stale, o.last_synced_at,
              (SELECT count(*) FROM fitments f WHERE f.product_id = p.id) AS fitments
       FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN brands b ON b.id = p.brand_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       JOIN categories c ON c.id = mp.category_id
       WHERE o.partner_id = $1
         AND ($2::boolean IS NULL OR (p.approved_at IS NULL) = $2)
       ORDER BY p.approved_at IS NULL DESC, p.name`,
      [partnerId, filter.pending ?? null],
    );
  }

  /**
   * Sales, by day and by product.
   *
   * Only what the partner actually earned: the platform's markup is excluded,
   * because it was never theirs and showing it would misstate their revenue.
   */
  async salesReport(principal: Principal, range: { from?: string; to?: string } = {}) {
    const partnerId = resolvePartnerScope(principal);
    if (!partnerId) throw errors.notFound('Partner');

    const from = range.from ?? null;
    const to = range.to ?? null;

    const [totals] = await this.db.query<Record<string, string>>(
      `SELECT
         count(DISTINCT po.order_id)::text AS orders,
         COALESCE(sum(oi.quantity), 0)::text AS units,
         COALESCE(sum(oi.base_price_minor * oi.quantity), 0)::text AS revenue_minor,
         COALESCE(sum(oi.markup_minor * oi.quantity), 0)::text AS platform_markup_minor
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       JOIN order_items oi ON oi.partner_order_id = po.id
       WHERE po.partner_id = $1
         AND o.status IN ('PAID','READY_FOR_PICKUP','PICKED_UP','COMPLETED')
         AND ($2::date IS NULL OR o.created_at >= $2::date)
         AND ($3::date IS NULL OR o.created_at < ($3::date + interval '1 day'))`,
      [partnerId, from, to],
    );

    const daily = await this.db.query(
      `SELECT o.created_at::date::text AS day,
              count(DISTINCT o.id)::text AS orders,
              COALESCE(sum(oi.base_price_minor * oi.quantity), 0)::text AS revenue_minor
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       JOIN order_items oi ON oi.partner_order_id = po.id
       WHERE po.partner_id = $1
         AND o.status IN ('PAID','READY_FOR_PICKUP','PICKED_UP','COMPLETED')
         AND ($2::date IS NULL OR o.created_at >= $2::date)
         AND ($3::date IS NULL OR o.created_at < ($3::date + interval '1 day'))
       GROUP BY 1 ORDER BY 1`,
      [partnerId, from, to],
    );

    const topProducts = await this.db.query(
      `SELECT p.id, p.name, b.name AS brand,
              sum(oi.quantity)::text AS units,
              sum(oi.base_price_minor * oi.quantity)::text AS revenue_minor
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       JOIN order_items oi ON oi.partner_order_id = po.id
       JOIN products p ON p.id = oi.product_id
       JOIN brands b ON b.id = p.brand_id
       WHERE po.partner_id = $1
         AND o.status IN ('PAID','READY_FOR_PICKUP','PICKED_UP','COMPLETED')
         AND ($2::date IS NULL OR o.created_at >= $2::date)
         AND ($3::date IS NULL OR o.created_at < ($3::date + interval '1 day'))
       GROUP BY p.id, p.name, b.name
       ORDER BY sum(oi.base_price_minor * oi.quantity) DESC
       LIMIT 10`,
      [partnerId, from, to],
    );

    return { range: { from, to }, totals, daily, topProducts };
  }

  /** Reuses a brand by name, so two partners spelling it the same share one. */
  private async ensureBrand(tx: TransactionClient, name: string): Promise<string> {
    const trimmed = name.trim();
    const [existing] = await tx.query<{ id: string }>(
      `SELECT id FROM brands WHERE lower(name) = lower($1)`,
      [trimmed],
    );
    if (existing) return existing.id;

    const [created] = await tx.query<{ id: string }>(
      `INSERT INTO brands (name, type) VALUES ($1, 'UNKNOWN') RETURNING id`,
      [trimmed],
    );
    if (!created) throw errors.internal();
    return created.id;
  }

  /**
   * Reuses a master part within the category, or creates one.
   *
   * The master part is what fitment hangs off, so putting a partner's "front
   * brake disc" under the existing one rather than a private copy is what lets
   * it inherit the fitment work already done for that part.
   */
  private async ensureMasterPart(
    tx: TransactionClient,
    categoryId: string,
    partName: string,
  ): Promise<string> {
    const normalized = partName.trim().toLowerCase();
    const [existing] = await tx.query<{ id: string }>(
      `SELECT id FROM master_parts
       WHERE category_id = $1 AND lower(normalized_name) = $2`,
      [categoryId, normalized],
    );
    if (existing) return existing.id;

    const [created] = await tx.query<{ id: string }>(
      `INSERT INTO master_parts (category_id, normalized_name)
       VALUES ($1, $2) RETURNING id`,
      [categoryId, normalized],
    );
    if (!created) throw errors.internal();
    return created.id;
  }
}
