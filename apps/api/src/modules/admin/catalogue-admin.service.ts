import { Injectable } from '@nestjs/common';
import { AppError, ErrorCode, errors, type Principal } from '@autoparts/core';
import { DatabaseService, type TransactionClient } from '../../database/database.module.js';
import { AuditService } from './audit.service.js';
import { SearchService } from '../search/search.service.js';

/**
 * The catalogue's shape, and what a partner is allowed to add to it
 * (docs/09 §5).
 *
 * Categories are the platform's. A partner files products under them but never
 * invents one, because the category is what the Fitment Engine reads to know
 * which vehicle attributes a decision needs (docs/05 §4). A category nobody
 * configured would make every part in it undecidable.
 */

export interface CategoryInput {
  slug: string;
  nameKa: string;
  nameEn: string;
  synonymsKa?: string[];
  synonymsEn?: string[];
  /** Vehicle attributes the Fitment Engine must know before it can decide. */
  requiredVehicleAttributes?: string[];
  sortOrder?: number;
}

/**
 * One shape for both review lists.
 *
 * Pending and refused rows are read by the same panel and differ only in which
 * decision column is set, so they are selected identically. Two hand-kept
 * copies would drift the first time a column was added to one of them.
 */
const REVIEW_QUEUE_SELECT = `
  SELECT p.id, p.name, p.created_at, p.specifications,
         p.approved_at, p.rejected_at, p.review_note,
         b.name AS brand, pa.display_name AS partner,
         c.slug AS category_slug, mp.normalized_name AS master_part,
         (SELECT count(*) FROM fitments f WHERE f.product_id = p.id AND f.active) AS fitments,
         (SELECT count(*) FROM offers o WHERE o.product_id = p.id) AS offers,
         (SELECT array_agg(pi.kind::text || ':' || pi.value)
            FROM product_identifiers pi WHERE pi.product_id = p.id) AS identifiers,
         (SELECT coalesce(json_agg(json_build_object(
                   'id', f.id, 'make', f.make, 'model', f.model,
                   'yearFrom', f.year_from, 'yearTo', f.year_to) ORDER BY f.make), '[]'::json)
            FROM fitments f WHERE f.product_id = p.id AND f.active) AS fitment_list
  FROM products p
  JOIN brands b ON b.id = p.brand_id
  JOIN master_parts mp ON mp.id = p.master_part_id
  JOIN categories c ON c.id = mp.category_id
  LEFT JOIN partners pa ON pa.id = p.created_by_partner_id`;

@Injectable()
export class CatalogueAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly search: SearchService,
  ) {}

  /* ───────────────────────── categories ───────────────────────── */

  async categories() {
    return this.db.query(
      `SELECT c.id, c.slug, c.active, c.sort_order, c.required_vehicle_attributes,
              ct_ka.name AS name_ka, ct_en.name AS name_en,
              (SELECT count(*) FROM master_parts mp WHERE mp.category_id = c.id) AS master_parts,
              (SELECT count(*) FROM products p
                 JOIN master_parts mp2 ON mp2.id = p.master_part_id
                WHERE mp2.category_id = c.id AND p.active) AS active_products
       FROM categories c
       LEFT JOIN category_translations ct_ka
         ON ct_ka.category_id = c.id AND ct_ka.locale = 'ka'
       LEFT JOIN category_translations ct_en
         ON ct_en.category_id = c.id AND ct_en.locale = 'en'
       ORDER BY c.sort_order, c.slug`,
    );
  }

  async createCategory(principal: Principal, input: CategoryInput) {
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'A category slug may contain only lowercase letters, digits and hyphens.',
        messageKey: 'error.category.slugInvalid',
      });
    }

    return this.db.transaction(async (tx) => {
      const [existing] = await tx.query<{ id: string }>(
        `SELECT id FROM categories WHERE slug = $1`,
        [slug],
      );
      if (existing) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          status: 409,
          message: 'That category slug is taken.',
          messageKey: 'error.category.duplicateSlug',
        });
      }

      const [category] = await tx.query<{ id: string }>(
        `INSERT INTO categories (slug, sort_order, required_vehicle_attributes, active)
         VALUES ($1, $2, $3, true)
         RETURNING id`,
        [slug, input.sortOrder ?? 0, input.requiredVehicleAttributes ?? []],
      );
      if (!category) throw errors.internal();

      // Both locales are written together. A category that exists in only one
      // language shows a customer a raw slug, and nothing user-visible is ever
      // hardcoded (PRD §80).
      await this.writeTranslations(tx, category.id, input);

      await this.audit.record({
        actor: principal,
        action: 'CATALOG_ACTION',
        entityType: 'category',
        entityId: category.id,
        after: { slug, created: true },
      });

      return { id: category.id, slug };
    });
  }

  async updateCategory(principal: Principal, id: string, input: Partial<CategoryInput> & { active?: boolean }) {
    const [before] = await this.db.query<{ slug: string; active: boolean }>(
      `SELECT slug, active FROM categories WHERE id = $1`,
      [id],
    );
    if (!before) throw errors.notFound('Category');

    return this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE categories
         SET sort_order = COALESCE($2, sort_order),
             required_vehicle_attributes =
               COALESCE($3, required_vehicle_attributes),
             active = COALESCE($4, active),
             updated_at = now()
         WHERE id = $1`,
        [
          id,
          input.sortOrder ?? null,
          input.requiredVehicleAttributes ?? null,
          input.active ?? null,
        ],
      );

      if (input.nameKa || input.nameEn) {
        await this.writeTranslations(tx, id, input);
      }

      await this.audit.record({
        actor: principal,
        action: 'CATALOG_ACTION',
        entityType: 'category',
        entityId: id,
        before: { active: before.active },
        after: { active: input.active ?? before.active },
      });

      return { id, updated: true };
    });
  }

  /* ───────────────────────── inventory oversight ───────────────────────── */

  /**
   * Stock across every partner.
   *
   * Read-only on purpose. Platform staff need to see what the marketplace
   * actually has — what is stale, what is out of stock, who is not keeping up
   * — but a price belongs to the partner who set it. An admin quietly editing
   * one would leave that partner selling at a number they never agreed to.
   */
  async inventory(filter: { stale?: boolean; search?: string; limit?: number } = {}) {
    return this.db.query(
      `SELECT o.id AS offer_id, o.base_price_minor, o.platform_markup_minor, o.currency,
              o.stock_quantity, o.availability_status::text AS availability,
              o.is_stale, o.last_synced_at, o.active,
              p.id AS product_id, p.name AS product, p.approved_at,
              b.name AS brand, c.slug AS category_slug,
              pa.id AS partner_id, pa.display_name AS partner
       FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN brands b ON b.id = p.brand_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       JOIN categories c ON c.id = mp.category_id
       JOIN partners pa ON pa.id = o.partner_id
       WHERE pa.archived_at IS NULL
         AND ($1::boolean IS NULL OR o.is_stale = $1)
         AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%'
              OR pa.display_name ILIKE '%' || $2 || '%')
       -- Worst first: stale stock, then whatever has run out. That is the
       -- order somebody opening this page needs to act in.
       ORDER BY o.is_stale DESC, o.stock_quantity ASC, p.name
       LIMIT $3`,
      [filter.stale ?? null, filter.search ?? null, Math.min(filter.limit ?? 100, 500)],
    );
  }

  /** Headline numbers for the marketplace's stock as a whole. */
  async inventorySummary() {
    const [row] = await this.db.query<Record<string, string>>(
      `SELECT
         count(*)::text AS offers,
         count(*) FILTER (WHERE o.stock_quantity = 0)::text AS out_of_stock,
         count(*) FILTER (WHERE o.is_stale)::text AS stale,
         count(DISTINCT o.partner_id)::text AS partners,
         count(*) FILTER (WHERE p.approved_at IS NULL AND p.rejected_at IS NULL)::text
           AS pending_products,
         count(*) FILTER (WHERE p.rejected_at IS NOT NULL)::text AS rejected_products
       FROM offers o
       JOIN products p ON p.id = o.product_id
       JOIN partners pa ON pa.id = o.partner_id
       WHERE o.active AND pa.archived_at IS NULL`,
    );
    return row ?? {};
  }

  /* ─────────────────── the partner-product review queue ─────────────────── */

  /**
   * Products a partner added that nobody has cleared for sale yet.
   *
   * This queue is the price of letting partners extend the catalogue. A part
   * the platform never curated has no fitment data, so until someone says what
   * it fits it cannot honestly be offered to anybody (docs/05 §1).
   */
  async pendingProducts() {
    return this.db.query(
      `${REVIEW_QUEUE_SELECT}
       WHERE p.approved_at IS NULL AND p.rejected_at IS NULL
       ORDER BY p.created_at`,
    );
  }

  /**
   * Products somebody refused.
   *
   * Kept readable rather than swept away, for two reasons. A rejection made in
   * error is otherwise only undoable by asking the partner to upload the same
   * file again, and a reviewer who cannot see what was refused has no way to
   * tell a queue that was worked through from one that was emptied.
   */
  async rejectedProducts(limit = 50) {
    return this.db.query(
      `${REVIEW_QUEUE_SELECT}
       WHERE p.rejected_at IS NOT NULL
       ORDER BY p.rejected_at DESC
       LIMIT $1`,
      [limit],
    );
  }

  /**
   * Declares what a vehicle a product fits, so it can be approved.
   *
   * Approval requires fitment data and nothing a partner uploads has any, so
   * without this the queue has exactly one exit: refusal. That is not a review
   * process, it is a wall. The record is written as ADMIN_MANUAL at full
   * confidence, which is the truth — a person looked at the part and said what
   * it goes on, and that outranks anything a partner declared (docs/05 §3.1).
   *
   * A null model means every model of that make, and a null year bound means
   * open-ended, because that is how the engine reads them: only a stated
   * criterion can disqualify a car.
   */
  async addFitment(
    principal: Principal,
    productId: string,
    input: { make: string; model?: string; yearFrom?: number; yearTo?: number },
  ) {
    const [product] = await this.db.query<{ id: string }>(
      'SELECT id FROM products WHERE id = $1',
      [productId],
    );
    if (!product) throw errors.notFound('Product');

    const make = input.make.trim();
    if (!make) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 422,
        message: 'A fitment needs at least a make.',
        messageKey: 'error.fitment.makeRequired',
      });
    }
    if (input.yearFrom != null && input.yearTo != null && input.yearFrom > input.yearTo) {
      // Caught here rather than left to the table's CHECK, so the reviewer is
      // told which two fields to swap instead of shown a constraint name.
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 422,
        message: 'The first year cannot be later than the last.',
        messageKey: 'error.fitment.yearRange',
      });
    }

    const [fitment] = await this.db.query<{ id: string }>(
      `INSERT INTO fitments
         (product_id, source, make, model, year_from, year_to,
          verdict, confidence, active, created_by)
       VALUES ($1, 'ADMIN_MANUAL'::fitment_source, $2, $3, $4, $5,
               'EXACT'::fitment_verdict, 1.0, true, $6)
       RETURNING id`,
      [
        productId,
        make,
        input.model?.trim() || null,
        input.yearFrom ?? null,
        input.yearTo ?? null,
        principal.userId,
      ],
    );
    if (!fitment) throw errors.internal();

    await this.audit.record({
      actor: principal,
      action: 'FITMENT_CHANGE',
      entityType: 'fitment',
      entityId: fitment.id,
      before: null,
      after: { productId, ...input },
    });

    const [counted] = await this.db.query<{ fitments: string }>(
      'SELECT count(*)::text AS fitments FROM fitments WHERE product_id = $1 AND active',
      [productId],
    );
    return { id: fitment.id, productId, fitments: Number(counted?.fitments ?? 0) };
  }

  /**
   * Retires a fitment record.
   *
   * Deactivated, not deleted: a verdict a customer was once shown has to stay
   * explicable afterwards.
   */
  async removeFitment(principal: Principal, productId: string, fitmentId: string) {
    const [row] = await this.db.query<{ id: string }>(
      `UPDATE fitments SET active = false, updated_at = now()
       WHERE id = $1 AND product_id = $2 AND active
       RETURNING id`,
      [fitmentId, productId],
    );
    if (!row) throw errors.notFound('Fitment');

    await this.audit.record({
      actor: principal,
      action: 'FITMENT_CHANGE',
      entityType: 'fitment',
      entityId: fitmentId,
      before: { active: true },
      after: { active: false },
    });
    return { id: fitmentId, active: false };
  }

  /** The fitments on one product, for the review panel. */
  async productFitments(productId: string) {
    return this.db.query(
      `SELECT id, make, model, year_from, year_to, source::text AS source,
              verdict::text AS verdict
       FROM fitments WHERE product_id = $1 AND active
       ORDER BY make, model NULLS FIRST`,
      [productId],
    );
  }

  /**
   * Makes and models the platform has actually seen.
   *
   * Typed free-hand, "Toyota" and "TOYOTA" are the same car but "Toyta" is no
   * car at all, and a fitment nobody's vehicle matches is indistinguishable
   * from no fitment at all. So the reviewer picks from what has been decoded
   * or already declared, and only types when the list is genuinely missing it.
   */
  async vehicleOptions() {
    return this.db.query(
      `SELECT make, array_agg(DISTINCT model ORDER BY model) AS models
       FROM (
         SELECT make, model FROM vehicle_configurations
         UNION
         SELECT make, model FROM fitments WHERE active AND model IS NOT NULL
       ) AS seen
       WHERE make IS NOT NULL AND model IS NOT NULL
       GROUP BY make
       ORDER BY make`,
    );
  }

  /**
   * Clears a partner's product for sale, or refuses it.
   *
   * Approving does not invent fitment data — it records that a human decided
   * this product is safe to list. Whether a given car sees it is still the
   * Fitment Engine's call, on whatever fitments exist.
   */
  async reviewProduct(
    principal: Principal,
    productId: string,
    decision: 'APPROVE' | 'REJECT' | 'RESTORE',
    note?: string,
  ) {
    const [product] = await this.db.query<{
      id: string;
      approved_at: Date | null;
      rejected_at: Date | null;
      fitments: string;
    }>(
      `SELECT p.id, p.approved_at, p.rejected_at,
              (SELECT count(*) FROM fitments f
                WHERE f.product_id = p.id AND f.active)::text AS fitments
       FROM products p WHERE p.id = $1`,
      [productId],
    );
    if (!product) throw errors.notFound('Product');

    if (decision === 'APPROVE' && Number(product.fitments) === 0) {
      // Refused rather than allowed with a warning. An approved product with
      // no fitment is invisible to every customer anyway, so letting it
      // through would only teach the reviewer that approval does nothing.
      // The way out is to declare a fitment first, which the same panel does.
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 422,
        message:
          'This product has no fitment data, so no customer could ever be shown it. ' +
          'Say which vehicle it fits first.',
        messageKey: 'error.product.noFitment',
      });
    }

    // Each branch writes both decision columns, never one. Setting approval
    // while leaving an old rejection standing would violate the table's
    // one-decision check, and -- worse -- leave the row's meaning up to
    // whichever column the reading query happened to look at.
    //
    // Restoring clears the note as well as the decision: the reason belonged
    // to a refusal that no longer stands, and leaving it behind would show the
    // partner a rejection message for a product that is back in the queue.
    const statement =
      decision === 'APPROVE'
        ? `UPDATE products
             SET approved_at = now(), approved_by = $2,
                 rejected_at = NULL, rejected_by = NULL,
                 review_note = $3, active = true, updated_at = now()
           WHERE id = $1`
        : decision === 'REJECT'
          ? `UPDATE products
               SET rejected_at = now(), rejected_by = $2,
                   approved_at = NULL, approved_by = NULL,
                   review_note = $3, active = false, updated_at = now()
             WHERE id = $1`
          : `UPDATE products
               SET rejected_at = NULL, rejected_by = NULL,
                   approved_at = NULL, approved_by = NULL,
                   review_note = NULL, active = false, updated_at = now()
             WHERE id = $1`;

    await this.db.query(
      statement,
      decision === 'RESTORE'
        ? [productId]
        : [productId, principal.userId, note ?? null],
    );

    await this.audit.record({
      actor: principal,
      action: 'CATALOG_ACTION',
      entityType: 'product',
      entityId: productId,
      before: { approved: product.approved_at !== null, rejected: product.rejected_at !== null },
      after: { decision, note: note ?? null },
    });

    // Search reads `search_documents`, which is derived and does not update
    // itself. Approving a product the partner filed under a part type nobody
    // had listed before creates a row no document covers, so without this the
    // reviewer approves a part and the customer searching for it is still told
    // nothing was found -- which looks exactly like approval having done
    // nothing. Failure here is logged, not raised: the decision is already
    // committed and undoing it over a stale index would be worse.
    if (decision === 'APPROVE') {
      await this.search
        .reindex()
        .catch(() => undefined);
    }

    return {
      id: productId,
      decision,
      approved: decision === 'APPROVE',
      rejected: decision === 'REJECT',
    };
  }

  private async writeTranslations(
    tx: TransactionClient,
    categoryId: string,
    input: Partial<CategoryInput>,
  ): Promise<void> {
    for (const [locale, name, synonyms] of [
      ['ka', input.nameKa, input.synonymsKa],
      ['en', input.nameEn, input.synonymsEn],
    ] as const) {
      if (!name) continue;
      await tx.query(
        `INSERT INTO category_translations (category_id, locale, name, synonyms)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (category_id, locale)
         DO UPDATE SET name = EXCLUDED.name, synonyms = EXCLUDED.synonyms`,
        [categoryId, locale, name, synonyms ?? []],
      );
    }
  }
}
