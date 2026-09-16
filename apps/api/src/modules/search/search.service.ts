import { Injectable, Logger } from '@nestjs/common';
import { errors, isSellable, normalizeIdentifier, type FitmentVerdict } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { FitmentService } from '../fitment/fitment.service.js';

export interface SearchInterpretation {
  /** How the query was understood, so the UI can say so and a human can debug. */
  matchedBy: 'IDENTIFIER' | 'EXACT_TEXT' | 'FUZZY_TEXT' | 'NONE';
  categorySlug?: string;
  masterPartId?: string;
  masterPartName?: string;
  /** Set when the query was corrected, e.g. "აკუმლატორი" → "აკუმულატორი". */
  didYouMean?: string;
}

export interface SearchHit {
  productId: string;
  name: string;
  brand: { name: string; type: string };
  oem: string | null;
  masterPartId: string;
  masterPartName: string;
  categorySlug: string;
  fitment: { verdict: FitmentVerdict; confidence: number; labelKey: string };
  offerSummary: {
    count: number;
    minCustomerPriceMinor: string | null;
    currency: string | null;
    bestAvailability: string | null;
  };
}

export interface SearchResponse {
  interpreted: SearchInterpretation;
  data: SearchHit[];
  /** Present when nothing fits, so the UI can offer the next step (PRD §37). */
  emptyReason?: 'NO_QUERY_MATCH' | 'NO_COMPATIBLE_PRODUCTS' | 'NO_OFFERS';
}

const VERDICT_LABEL: Record<string, string> = {
  EXACT: 'fitment.exact',
  COMPATIBLE: 'fitment.compatible',
  CONDITIONAL: 'fitment.conditional',
};

/** Below this, a trigram match is noise rather than a typo. */
const FUZZY_THRESHOLD = 0.3;

@Injectable()
export class SearchService {
  private readonly logger = new Logger('SearchService');

  constructor(
    private readonly db: DatabaseService,
    private readonly fitment: FitmentService,
  ) {}

  /**
   * Search, always for a specific vehicle.
   *
   * `vehicleId` is required rather than optional: "find a part" without a car
   * is precisely the question this product exists to stop people answering
   * wrongly (PRD §14). The client picks the vehicle first; the API refuses
   * to pretend it can answer without one.
   */
  async search(params: {
    query: string;
    vehicleId: string;
    locale: string;
    availability?: 'IN_STOCK' | 'AVAILABLE_TO_ORDER' | 'BOTH';
    limit?: number;
  }): Promise<SearchResponse> {
    const query = params.query.trim();
    if (!query) throw errors.validation({ field: 'q', reason: 'empty' });

    const interpretation = await this.interpret(query, params.locale);

    if (interpretation.matchedBy === 'NONE') {
      return { interpreted: interpretation, data: [], emptyReason: 'NO_QUERY_MATCH' };
    }

    const candidateIds = await this.candidateProducts(interpretation);
    if (candidateIds.length === 0) {
      return { interpreted: interpretation, data: [], emptyReason: 'NO_QUERY_MATCH' };
    }

    // R1: the engine decides, and only confirmed fits survive. The index is a
    // way to find candidates quickly; it never has the last word, because it
    // can be stale while a conflict or an admin mapping is not (docs/05 §8).
    const verdicts = await this.fitment.evaluateForVehicle(params.vehicleId, candidateIds);
    const compatible = candidateIds.filter((id) => {
      const v = verdicts.get(id);
      return v && isSellable(v.verdict);
    });

    if (compatible.length === 0) {
      return { interpreted: interpretation, data: [], emptyReason: 'NO_COMPATIBLE_PRODUCTS' };
    }

    const rows = await this.hydrate(compatible, params.availability ?? 'BOTH', params.limit ?? 40);

    const data: SearchHit[] = rows.map((row) => {
      const verdict = verdicts.get(row.product_id)!;
      return {
        productId: row.product_id,
        name: row.name,
        brand: { name: row.brand_name, type: row.brand_type },
        oem: row.oem,
        masterPartId: row.master_part_id,
        masterPartName: row.master_part_name ?? row.name,
        categorySlug: row.category_slug,
        fitment: {
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          labelKey: VERDICT_LABEL[verdict.verdict] ?? 'fitment.compatible',
        },
        offerSummary: {
          count: Number(row.offer_count),
          minCustomerPriceMinor: row.min_price,
          currency: row.currency,
          bestAvailability: row.best_availability,
        },
      };
    });

    if (data.length === 0) {
      return { interpreted: interpretation, data: [], emptyReason: 'NO_OFFERS' };
    }

    return { interpreted: interpretation, data };
  }

  /**
   * What did the user mean?
   *
   * Identifier first: someone who pastes an OEM number knows exactly what they
   * want, and a text search over that string would find nothing.
   */
  private async interpret(query: string, locale: string): Promise<SearchInterpretation> {
    const asIdentifier = normalizeIdentifier(query);
    if (/^[A-Z0-9]{6,50}$/.test(asIdentifier)) {
      const [hit] = await this.db.query<{ product_id: string }>(
        `SELECT product_id FROM product_identifiers WHERE normalized = $1 LIMIT 1`,
        [asIdentifier],
      );
      if (hit) return { matchedBy: 'IDENTIFIER' };
    }

    const normalized = query.toLowerCase();

    // Exact-ish: every word present, in any order.
    const [exact] = await this.db.query<{
      master_part_id: string; part_name: string; category_slug: string; rank: number;
    }>(
      `SELECT master_part_id, part_name, category_slug,
              ts_rank(content_tsv, plainto_tsquery('simple', $1)) AS rank
       FROM search_documents
       WHERE locale = $2 AND content_tsv @@ plainto_tsquery('simple', $1)
         -- A part type with nothing sellable under it must never win a
         -- search. It matches the words perfectly and then hands back an
         -- empty page -- a dead end that reads as "this site is broken".
         -- Partner-added products are inactive until reviewed, so without
         -- this a single pending upload can shadow a real part type.
         AND EXISTS (
           SELECT 1 FROM products prod
           WHERE prod.master_part_id = search_documents.master_part_id
             AND prod.active
         )
       ORDER BY rank DESC
       LIMIT 1`,
      [normalized, locale],
    );

    if (exact) {
      return {
        matchedBy: 'EXACT_TEXT',
        masterPartId: exact.master_part_id,
        masterPartName: exact.part_name,
        categorySlug: exact.category_slug,
      };
    }

    // Typo tolerance (PRD §13).
    //
    // Matched against a transliterated copy of the text. pg_trgm decides what
    // is a letter from the database ctype, and under a Latin locale Georgian
    // characters are not letters — it produces no trigrams at all, so matching
    // the original text would silently never fire (migration 0006).
    //
    // `word_similarity`, not `similarity`: the indexed content is a whole
    // document — part name, every synonym, the category and its synonyms — so
    // comparing a two-word query against all of it scores near zero no matter
    // how good the match. word_similarity scores the query against the best
    // matching run of words inside the document, which is the question being
    // asked.
    const [fuzzy] = await this.db.query<{
      master_part_id: string; part_name: string; category_slug: string; sim: number;
    }>(
      `SELECT master_part_id, part_name, category_slug,
              word_similarity(translit_ka($1), content_translit) AS sim
       FROM search_documents
       WHERE locale = $2 AND translit_ka($1) <% content_translit
         -- A part type with nothing sellable under it must never win a
         -- search. It matches the words perfectly and then hands back an
         -- empty page -- a dead end that reads as "this site is broken".
         -- Partner-added products are inactive until reviewed, so without
         -- this a single pending upload can shadow a real part type.
         AND EXISTS (
           SELECT 1 FROM products prod
           WHERE prod.master_part_id = search_documents.master_part_id
             AND prod.active
         )
       ORDER BY sim DESC
       LIMIT 1`,
      [normalized, locale],
    );

    if (fuzzy && Number(fuzzy.sim) >= FUZZY_THRESHOLD) {
      return {
        matchedBy: 'FUZZY_TEXT',
        masterPartId: fuzzy.master_part_id,
        masterPartName: fuzzy.part_name,
        categorySlug: fuzzy.category_slug,
        // Surfaced rather than applied silently: a corrected search that finds
        // the wrong part is worse than one that says what it corrected to.
        didYouMean: fuzzy.part_name,
      };
    }

    return { matchedBy: 'NONE' };
  }

  private async candidateProducts(interpretation: SearchInterpretation): Promise<string[]> {
    if (interpretation.masterPartId) {
      const rows = await this.db.query<{ id: string }>(
        `SELECT id FROM products WHERE master_part_id = $1 AND active`,
        [interpretation.masterPartId],
      );
      return rows.map((r) => r.id);
    }
    return [];
  }

  private async hydrate(productIds: string[], availability: string, limit: number) {
    const availabilityFilter =
      availability === 'BOTH'
        ? ['IN_STOCK', 'AVAILABLE_TO_ORDER']
        : [availability];

    return this.db.query<{
      product_id: string; name: string; brand_name: string; brand_type: string;
      oem: string | null; master_part_id: string; master_part_name: string | null;
      category_slug: string; offer_count: string; min_price: string | null;
      currency: string | null; best_availability: string | null;
    }>(
      `SELECT p.id AS product_id, p.name, b.name AS brand_name, b.brand_type AS brand_type,
              (SELECT pi.value FROM product_identifiers pi
                WHERE pi.product_id = p.id AND pi.kind = 'OEM'
                ORDER BY pi.is_primary DESC LIMIT 1) AS oem,
              mp.id AS master_part_id,
              (SELECT t.name FROM master_part_translations t
                WHERE t.master_part_id = mp.id ORDER BY (t.locale = 'ka') DESC LIMIT 1)
                AS master_part_name,
              c.slug AS category_slug,
              COALESCE(o.offer_count, 0)::text AS offer_count,
              o.min_price::text, o.currency, o.best_availability
       FROM products p
       JOIN brands b ON b.id = p.brand_id
       JOIN master_parts mp ON mp.id = p.master_part_id
       JOIN categories c ON c.id = mp.category_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS offer_count,
                min(customer_price_minor) AS min_price,
                min(currency) AS currency,
                -- IN_STOCK sorts before AVAILABLE_TO_ORDER alphabetically, which
                -- is the order we want for "best".
                min(availability_status::text) AS best_availability
         FROM offers
         WHERE product_id = p.id AND active
           AND availability_status::text = ANY($2::text[])
       ) o ON true
       WHERE p.id = ANY($1::uuid[])
         AND COALESCE(o.offer_count, 0) > 0
       ORDER BY o.min_price NULLS LAST
       LIMIT $3`,
      [productIds, availabilityFilter, limit],
    );
  }

  /** Called after a catalogue change so the index cannot silently go stale. */
  async reindex(): Promise<number> {
    const [row] = await this.db.query<{ rebuild_search_documents: number }>(
      `SELECT rebuild_search_documents()`,
    );
    const count = row?.rebuild_search_documents ?? 0;
    this.logger.log(JSON.stringify({ event: 'search_reindex', documents: count }));
    return count;
  }
}
