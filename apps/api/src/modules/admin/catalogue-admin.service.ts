import { Injectable } from '@nestjs/common';
import { AppError, ErrorCode, errors, type Principal } from '@autoparts/core';
import { DatabaseService, type TransactionClient } from '../../database/database.module.js';
import { AuditService } from './audit.service.js';

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

@Injectable()
export class CatalogueAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
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
      `SELECT p.id, p.name, p.created_at, p.specifications,
              b.name AS brand, pa.display_name AS partner,
              c.slug AS category_slug, mp.normalized_name AS master_part,
              (SELECT count(*) FROM fitments f WHERE f.product_id = p.id) AS fitments,
              (SELECT count(*) FROM offers o WHERE o.product_id = p.id) AS offers,
              (SELECT array_agg(pi.kind::text || ':' || pi.value)
                 FROM product_identifiers pi WHERE pi.product_id = p.id) AS identifiers
       FROM products p
       JOIN brands b ON b.id = p.brand_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       JOIN categories c ON c.id = mp.category_id
       LEFT JOIN partners pa ON pa.id = p.created_by_partner_id
       WHERE p.approved_at IS NULL
       ORDER BY p.created_at`,
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
    decision: 'APPROVE' | 'REJECT',
    note?: string,
  ) {
    const [product] = await this.db.query<{
      id: string;
      approved_at: Date | null;
      fitments: string;
    }>(
      `SELECT p.id, p.approved_at,
              (SELECT count(*) FROM fitments f WHERE f.product_id = p.id)::text AS fitments
       FROM products p WHERE p.id = $1`,
      [productId],
    );
    if (!product) throw errors.notFound('Product');

    if (decision === 'APPROVE' && Number(product.fitments) === 0) {
      // Refused rather than allowed with a warning. An approved product with
      // no fitment is invisible to every customer anyway, so letting it
      // through would only teach the reviewer that approval does nothing.
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 422,
        message: 'This product has no fitment data, so no customer could ever be shown it.',
        messageKey: 'error.product.noFitment',
      });
    }

    await this.db.query(
      decision === 'APPROVE'
        ? `UPDATE products
             SET approved_at = now(), approved_by = $2, active = true, updated_at = now()
           WHERE id = $1`
        : `UPDATE products
             SET approved_at = NULL, approved_by = $2, active = false, updated_at = now()
           WHERE id = $1`,
      [productId, principal.userId],
    );

    await this.audit.record({
      actor: principal,
      action: 'CATALOG_ACTION',
      entityType: 'product',
      entityId: productId,
      before: { approved: product.approved_at !== null },
      after: { approved: decision === 'APPROVE', note: note ?? null },
    });

    return { id: productId, approved: decision === 'APPROVE' };
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
