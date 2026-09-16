import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import {
  normalizeRows,
  type NormalizedInventoryItem,
  type RowError,
} from '@autoparts/providers';
import { normalizeIdentifier } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { PricingService } from '../pricing/pricing.service.js';

export interface ImportSummary {
  syncId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  rowsTotal: number;
  rowsOk: number;
  rowsFailed: number;
  errors: RowError[];
  /** Rows that matched nothing unambiguously and need an admin (docs/06 §4). */
  pendingReview: number;
  /** New products this upload added, all of them awaiting review. */
  createdProducts: number;
}

interface MatchOutcome {
  productId: string | null;
  reason: 'EXACT_IDENTIFIER' | 'AMBIGUOUS' | 'NOT_FOUND';
  candidates?: string[];
}

@Injectable()
export class PartnerInventoryService {
  private readonly logger = new Logger('PartnerInventory');

  constructor(
    private readonly db: DatabaseService,
    private readonly pricing: PricingService,
  ) {}

  /** Parses an uploaded CSV/TSV buffer into rows. */
  parseCsv(buffer: Buffer): Record<string, string>[] {
    const text = stripBom(buffer.toString('utf8'));
    return parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      // Partners in this region export from Excel as often as not, and Excel
      // writes semicolons under a Georgian locale.
      delimiter: detectDelimiter(text),
    }) as Record<string, string>[];
  }

  async importRows(
    partnerId: string,
    rows: Record<string, string>[],
    mode: 'CSV' | 'API' | 'MANUAL',
    fileUrl?: string,
    /**
     * Whether a row that matches nothing in the catalogue should create a
     * product, or be reported as an error.
     *
     * Off by default, and that default matters. The routine use of this
     * endpoint is a partner reposting their price list every morning, where a
     * row matching nothing almost always means a typo in a part number —
     * creating a product for it would quietly fill the catalogue with
     * misspelled duplicates nobody can ever find. Loading a catalogue for the
     * first time is the rarer, deliberate case, so it is the one that has to
     * be asked for.
     */
    createMissing = false,
  ): Promise<ImportSummary> {
    const [partner] = await this.db.query<{
      field_mapping: Record<string, string[]>;
      currency: string;
      default_location: string | null;
    }>(
      `SELECT p.field_mapping, p.currency,
              (SELECT l.id FROM partner_locations l
               WHERE l.partner_id = p.id AND l.active
               ORDER BY l.created_at LIMIT 1) AS default_location
       FROM partners p WHERE p.id = $1`,
      [partnerId],
    );
    if (!partner) throw new Error('Partner not found');

    const [sync] = await this.db.query<{ id: string }>(
      `INSERT INTO inventory_syncs (partner_id, mode, status, rows_total, file_url)
       VALUES ($1, $2, 'RUNNING', $3, $4) RETURNING id`,
      [partnerId, mode, rows.length, fileUrl ?? null],
    );
    const syncId = sync!.id;

    const { items, errors } = normalizeRows(rows, partner.field_mapping ?? {}, {
      currency: partner.currency,
    });

    let ok = 0;
    let pendingReview = 0;
    let createdProducts = 0;

    for (const [index, item] of items.entries()) {
      const match = await this.matchProduct(item);

      if (match.productId === null) {
        // Ambiguity is never resolved by creating another one: a part number
        // that already matches two products would become three.
        if (createMissing && match.reason === 'NOT_FOUND') {
          const created = await this.createProductFromRow(partnerId, item, index + 2);
          if (created.productId) {
            await this.upsertOffer(partnerId, partner.default_location, created.productId, item);
            createdProducts++;
            ok++;
            continue;
          }
          errors.push(created.error!);
          continue;
        }

        pendingReview++;
        errors.push({
          row: index + 2,
          column: 'oem',
          code: match.reason === 'AMBIGUOUS' ? 'AMBIGUOUS_MATCH' : 'PRODUCT_NOT_FOUND',
          message:
            match.reason === 'AMBIGUOUS'
              ? `Matches ${match.candidates?.length} products; an admin must decide`
              : 'No product in the catalogue carries this identifier',
          value: item.identifiers[0]?.value,
        });
        continue;
      }

      await this.upsertOffer(partnerId, partner.default_location, match.productId, item);
      ok++;
    }

    const failed = rows.length - ok;
    const status: ImportSummary['status'] =
      ok === 0 ? 'FAILED' : failed === 0 ? 'SUCCESS' : 'PARTIAL';

    await this.db.query(
      `UPDATE inventory_syncs
       SET status = $2, rows_ok = $3, rows_failed = $4, errors = $5, finished_at = now()
       WHERE id = $1`,
      [syncId, status, ok, failed, JSON.stringify(errors.slice(0, 500))],
    );

    await this.db.query(
      `UPDATE partners SET integration_mode = $2, updated_at = now() WHERE id = $1`,
      [partnerId, mode],
    );

    this.logger.log(
      JSON.stringify({ event: 'inventory_sync', partnerId, syncId, status, ok, failed }),
    );

    return {
      syncId,
      status,
      rowsTotal: rows.length,
      rowsOk: ok,
      rowsFailed: failed,
      // Capped: a partner does not need 40,000 error lines in one response, and
      // the full list is downloadable from the sync record.
      errors: errors.slice(0, 100),
      pendingReview,
      createdProducts,
    };
  }

  /**
   * Product matching (PRD §58, docs/06 §4).
   *
   * Identifier first, and only an identifier. Two products with similar names
   * may be for different cars entirely — a name is a search signal, never an
   * identity — so anything short of an unambiguous identifier match goes to an
   * admin rather than being guessed.
   */
  private async matchProduct(item: NormalizedInventoryItem): Promise<MatchOutcome> {
    for (const identifier of item.identifiers) {
      const rows = await this.db.query<{ product_id: string }>(
        `SELECT DISTINCT pi.product_id
         FROM product_identifiers pi
         JOIN products p ON p.id = pi.product_id AND p.active
         WHERE pi.kind = $1 AND pi.normalized = $2`,
        [identifier.kind, normalizeIdentifier(identifier.value)],
      );

      if (rows.length === 1) {
        return { productId: rows[0]!.product_id, reason: 'EXACT_IDENTIFIER' };
      }
      if (rows.length > 1) {
        return {
          productId: null,
          reason: 'AMBIGUOUS',
          candidates: rows.map((r) => r.product_id),
        };
      }
    }
    return { productId: null, reason: 'NOT_FOUND' };
  }

  /**
   * Creates a product from a spreadsheet row, for a partner loading their
   * catalogue for the first time.
   *
   * Born inert, exactly like one added through the form: `approved_at` null
   * and `active` false, held that way by a CHECK constraint. A part nobody has
   * established fitment for matches no car, so listing it would break the one
   * promise the product makes (ADR-016). The partner gets their prices and
   * stock loaded; the platform decides what customers are shown.
   *
   * Returns the row error rather than throwing, so one unusable line does not
   * abandon the other nine hundred.
   */
  private async createProductFromRow(
    partnerId: string,
    item: NormalizedInventoryItem,
    rowNumber: number,
  ): Promise<{ productId: string | null; error?: RowError }> {
    if (!item.categorySlug) {
      return {
        productId: null,
        error: {
          row: rowNumber,
          column: 'category',
          code: 'MISSING_CATEGORY',
          message: 'A new product needs a category — add a "category" column',
          value: item.productName,
        },
      };
    }

    const [category] = await this.db.query<{ id: string }>(
      `SELECT id FROM categories WHERE slug = $1 AND active`,
      [item.categorySlug.trim().toLowerCase()],
    );
    if (!category) {
      return {
        productId: null,
        error: {
          row: rowNumber,
          column: 'category',
          code: 'UNKNOWN_CATEGORY',
          message: `No category "${item.categorySlug}" — use one of the slugs from the template`,
          value: item.categorySlug,
        },
      };
    }

    try {
      return await this.db.transaction(async (tx) => {
        const brandNormalized = normalizeIdentifier(item.brandName);
        const [brand] = await tx.query<{ id: string }>(
          `INSERT INTO brands (name, normalized_name, brand_type)
           VALUES ($1, $2, 'AFTERMARKET')
           ON CONFLICT (normalized_name) DO UPDATE SET name = brands.name
           RETURNING id`,
          [item.brandName.trim(), brandNormalized],
        );

        // Filed under an existing master part where the name matches, so the
        // fitment work already done for that part is inherited rather than
        // starting again for every partner who stocks it.
        //
        // The TYPE, not the product name. "front brake pads" is a type many
        // brands make; "Ferodo FDB1234 front brake pads" is one product. Using
        // the product name would give every product a private type of its own,
        // and fitment established for one would benefit none of the others —
        // which is the entire reason master parts exist.
        //
        // Falls back to the product name when the file has no part_type
        // column, because a slightly duplicated type is still better than
        // refusing the upload outright.
        const partKey = (item.partType ?? item.productName).trim().toLowerCase().slice(0, 120);
        const [masterPart] = await tx.query<{ id: string }>(
          `INSERT INTO master_parts (category_id, normalized_name)
           SELECT $1, $2
           WHERE NOT EXISTS (
             SELECT 1 FROM master_parts
             WHERE category_id = $1 AND lower(normalized_name) = $2
           )
           RETURNING id`,
          [category.id, partKey],
        );
        const masterPartId =
          masterPart?.id ??
          (
            await tx.query<{ id: string }>(
              `SELECT id FROM master_parts
               WHERE category_id = $1 AND lower(normalized_name) = $2 LIMIT 1`,
              [category.id, partKey],
            )
          )[0]!.id;

        const [product] = await tx.query<{ id: string }>(
          `INSERT INTO products (master_part_id, brand_id, name, warranty_months,
                                 created_by_partner_id, approved_at, active)
           VALUES ($1, $2, $3, $4, $5, NULL, false)
           RETURNING id`,
          [
            masterPartId,
            brand!.id,
            item.productName.trim(),
            item.warrantyMonths ?? null,
            partnerId,
          ],
        );

        for (const identifier of item.identifiers) {
          await tx.query(
            `INSERT INTO product_identifiers (product_id, kind, value, normalized)
             VALUES ($1, $2::identifier_kind, $3, $4)
             ON CONFLICT DO NOTHING`,
            [product!.id, identifier.kind, identifier.value, identifier.normalized],
          );
        }

        return { productId: product!.id };
      });
    } catch (error) {
      return {
        productId: null,
        error: {
          row: rowNumber,
          column: 'name',
          code: 'CREATE_FAILED',
          message: error instanceof Error ? error.message.slice(0, 160) : 'Could not create',
          value: item.productName,
        },
      };
    }
  }

  private async upsertOffer(
    partnerId: string,
    locationId: string | null,
    productId: string,
    item: NormalizedInventoryItem,
  ): Promise<void> {
    const [category] = await this.db.query<{ category_id: string }>(
      `SELECT mp.category_id FROM products p
       JOIN master_parts mp ON mp.id = p.master_part_id
       WHERE p.id = $1`,
      [productId],
    );

    const markup = await this.pricing.computeMarkupMinor(item.priceMinor, {
      partnerId,
      categoryId: category?.category_id ?? null,
    });

    await this.db.query(
      `INSERT INTO offers (partner_id, product_id, location_id, partner_sku,
                           base_price_minor, platform_markup_minor, currency,
                           stock_quantity, availability_status,
                           expected_availability_days, warranty_months,
                           last_synced_at, is_stale, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), false, true)
       ON CONFLICT (partner_id, product_id,
                    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET
         partner_sku = EXCLUDED.partner_sku,
         base_price_minor = EXCLUDED.base_price_minor,
         platform_markup_minor = EXCLUDED.platform_markup_minor,
         stock_quantity = EXCLUDED.stock_quantity,
         availability_status = EXCLUDED.availability_status,
         expected_availability_days = EXCLUDED.expected_availability_days,
         warranty_months = EXCLUDED.warranty_months,
         last_synced_at = now(),
         is_stale = false,
         active = true,
         updated_at = now()`,
      [
        partnerId,
        productId,
        locationId,
        item.sku,
        item.priceMinor.toString(),
        markup.toString(),
        item.currency,
        item.quantity,
        item.availability,
        item.expectedAvailabilityDays,
        item.warrantyMonths,
      ],
    );
  }

  async syncHistory(partnerId: string, limit = 20) {
    return this.db.query(
      `SELECT id, mode, status, rows_total, rows_ok, rows_failed,
              started_at, finished_at, jsonb_array_length(errors) AS error_count
       FROM inventory_syncs
       WHERE partner_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [partnerId, limit],
    );
  }

  async syncDetail(partnerId: string, syncId: string) {
    const [row] = await this.db.query(
      // Scoped by partner_id: another partner's sync must read as absent.
      `SELECT id, mode, status, rows_total, rows_ok, rows_failed, errors,
              started_at, finished_at
       FROM inventory_syncs WHERE id = $1 AND partner_id = $2`,
      [syncId, partnerId],
    );
    return row ?? null;
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Excel under a non-English locale writes semicolons; guess from the header. */
function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (header.match(/;/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  const tabs = (header.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) return '\t';
  return semicolons > commas ? ';' : ',';
}
