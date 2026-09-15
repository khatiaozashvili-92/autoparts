import { Injectable } from '@nestjs/common';
import { errors, isSellable, type FitmentVerdict } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { FitmentService } from '../fitment/fitment.service.js';

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  synonyms: string[];
  children: CategoryNode[];
}

export interface MasterPartSummary {
  id: string;
  key: string;
  name: string;
  categorySlug: string;
  position: string | null;
  axle: string | null;
  /** Products that may be shown for the selected vehicle, if one was given. */
  availableProducts?: number;
}

export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  brand: { id: string; name: string; type: string };
  masterPart: { id: string; name: string; categorySlug: string };
  condition: string;
  warrantyMonths: number | null;
  countryOfOrigin: string | null;
  installationNotes: string | null;
  specifications: Record<string, unknown>;
  identifiers: { kind: string; value: string; isPrimary: boolean }[];
  images: string[];
  fitment?: {
    verdict: FitmentVerdict;
    confidence: number;
    labelKey: string;
    clarification?: unknown;
  };
}

/** UI label per verdict (PRD §55). UNCERTAIN has no label — it is never shown. */
const VERDICT_LABEL: Record<string, string> = {
  EXACT: 'fitment.exact',
  COMPATIBLE: 'fitment.compatible',
  CONDITIONAL: 'fitment.conditional',
  NOT_COMPATIBLE: 'fitment.notCompatible',
  UNCERTAIN: 'fitment.uncertain',
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fitment: FitmentService,
  ) {}

  async categories(locale: string): Promise<CategoryNode[]> {
    const rows = await this.db.query<{
      id: string;
      parent_id: string | null;
      slug: string;
      name: string | null;
      synonyms: string[] | null;
      sort_order: number;
    }>(
      // Falls back to the Georgian name when a locale has no translation, so a
      // missing translation degrades to a readable page rather than a blank one.
      `SELECT c.id, c.parent_id, c.slug, c.sort_order,
              COALESCE(t.name, fallback.name) AS name,
              COALESCE(t.synonyms, fallback.synonyms) AS synonyms
       FROM categories c
       LEFT JOIN category_translations t
         ON t.category_id = c.id AND t.locale = $1
       LEFT JOIN category_translations fallback
         ON fallback.category_id = c.id AND fallback.locale = 'ka'
       WHERE c.active
       ORDER BY c.sort_order, c.slug`,
      [locale],
    );

    const nodes = new Map<string, CategoryNode>();
    for (const row of rows) {
      nodes.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name ?? row.slug,
        synonyms: row.synonyms ?? [],
        children: [],
      });
    }

    const roots: CategoryNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      const parent = row.parent_id ? nodes.get(row.parent_id) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /**
   * Master parts in a category.
   *
   * With a `vehicleId` the count of showable products is computed per part, so
   * the category page can hide a part nothing fits rather than leading the user
   * into an empty result (PRD §37).
   */
  async partsInCategory(
    slug: string,
    locale: string,
    vehicleId?: string,
  ): Promise<MasterPartSummary[]> {
    const rows = await this.db.query<{
      id: string;
      key: string;
      name: string | null;
      category_slug: string;
      position: string | null;
      axle: string | null;
      product_ids: string[];
    }>(
      `SELECT mp.id, mp.normalized_name AS key, mp.position, mp.axle,
              c.slug AS category_slug,
              COALESCE(t.name, fb.name) AS name,
              COALESCE(array_agg(p.id) FILTER (WHERE p.id IS NOT NULL), '{}') AS product_ids
       FROM master_parts mp
       JOIN categories c ON c.id = mp.category_id
       LEFT JOIN master_part_translations t ON t.master_part_id = mp.id AND t.locale = $2
       LEFT JOIN master_part_translations fb ON fb.master_part_id = mp.id AND fb.locale = 'ka'
       LEFT JOIN products p ON p.master_part_id = mp.id AND p.active
       WHERE c.slug = $1
       GROUP BY mp.id, mp.normalized_name, mp.position, mp.axle, c.slug, t.name, fb.name
       ORDER BY COALESCE(t.name, fb.name, mp.normalized_name)`,
      [slug, locale],
    );

    if (!vehicleId) {
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name ?? row.key,
        categorySlug: row.category_slug,
        position: row.position,
        axle: row.axle,
      }));
    }

    const allProductIds = [...new Set(rows.flatMap((r) => r.product_ids))];
    const sellable = await this.fitment.filterSellable(vehicleId, allProductIds);

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name ?? row.key,
      categorySlug: row.category_slug,
      position: row.position,
      axle: row.axle,
      availableProducts: row.product_ids.filter((id) => sellable.has(id)).length,
    }));
  }

  async product(id: string, locale: string, vehicleId?: string): Promise<ProductDetail> {
    const [row] = await this.db.query<{
      id: string;
      name: string;
      description: string | null;
      condition: string;
      warranty_months: number | null;
      country_of_origin: string | null;
      installation_notes: string | null;
      specifications: Record<string, unknown>;
      brand_id: string;
      brand_name: string;
      brand_type: string;
      master_part_id: string;
      master_part_name: string | null;
      category_slug: string;
      identifiers: { kind: string; value: string; is_primary: boolean }[] | null;
      images: string[] | null;
    }>(
      `SELECT p.id, p.name, p.description, p.condition, p.warranty_months,
              p.country_of_origin, p.installation_notes, p.specifications,
              b.id AS brand_id, b.name AS brand_name, b.brand_type AS brand_type,
              mp.id AS master_part_id, COALESCE(t.name, fb.name) AS master_part_name,
              c.slug AS category_slug,
              (SELECT jsonb_agg(jsonb_build_object('kind', pi.kind, 'value', pi.value,
                                                   'is_primary', pi.is_primary)
                                ORDER BY pi.is_primary DESC, pi.kind)
               FROM product_identifiers pi WHERE pi.product_id = p.id) AS identifiers,
              (SELECT array_agg(img.url ORDER BY img.sort_order)
               FROM product_images img WHERE img.product_id = p.id) AS images
       FROM products p
       JOIN brands b ON b.id = p.brand_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       JOIN categories c ON c.id = mp.category_id
       LEFT JOIN master_part_translations t ON t.master_part_id = mp.id AND t.locale = $2
       LEFT JOIN master_part_translations fb ON fb.master_part_id = mp.id AND fb.locale = 'ka'
       WHERE p.id = $1 AND p.active`,
      [id, locale],
    );

    if (!row) throw errors.notFound('Product');

    const detail: ProductDetail = {
      id: row.id,
      name: row.name,
      description: row.description,
      brand: { id: row.brand_id, name: row.brand_name, type: row.brand_type },
      masterPart: {
        id: row.master_part_id,
        name: row.master_part_name ?? row.name,
        categorySlug: row.category_slug,
      },
      condition: row.condition,
      warrantyMonths: row.warranty_months,
      countryOfOrigin: row.country_of_origin,
      installationNotes: row.installation_notes,
      specifications: row.specifications ?? {},
      identifiers: (row.identifiers ?? []).map((i) => ({
        kind: i.kind,
        value: i.value,
        isPrimary: i.is_primary,
      })),
      images: row.images ?? [],
    };

    if (vehicleId) {
      const result = await this.fitment.evaluateOne(vehicleId, id);
      if (result) {
        detail.fitment = {
          verdict: result.verdict,
          confidence: result.confidence,
          labelKey: VERDICT_LABEL[result.verdict] ?? 'fitment.uncertain',
          ...(result.clarification ? { clarification: result.clarification } : {}),
        };
      }
    }

    return detail;
  }

  async brands(): Promise<{ id: string; name: string; type: string }[]> {
    const rows = await this.db.query<{ id: string; name: string; brand_type: string }>(
      `SELECT id, name, brand_type FROM brands ORDER BY brand_type, name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, type: r.brand_type }));
  }

  /** Products for a master part, filtered to what may be shown for the vehicle. */
  async productsForPart(
    masterPartId: string,
    vehicleId: string,
    locale: string,
  ): Promise<ProductDetail[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM products WHERE master_part_id = $1 AND active`,
      [masterPartId],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    const results = await this.fitment.evaluateForVehicle(vehicleId, ids);

    const out: ProductDetail[] = [];
    for (const id of ids) {
      const result = results.get(id);
      // R1: only confirmed fits reach the client. Anything else is absent, not
      // greyed out — "maybe compatible" is not a state the UI may render (§55).
      if (!result || !isSellable(result.verdict)) continue;
      const detail = await this.product(id, locale);
      detail.fitment = {
        verdict: result.verdict,
        confidence: result.confidence,
        labelKey: VERDICT_LABEL[result.verdict] ?? 'fitment.uncertain',
        ...(result.clarification ? { clarification: result.clarification } : {}),
      };
      out.push(detail);
    }
    return out;
  }
}
