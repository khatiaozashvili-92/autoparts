import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/common.js';
import { DatabaseService } from '../../database/database.module.js';

/**
 * Read-only catalogue counters.
 *
 * Step 2 has a schema and seed data but no domain endpoints yet, so this is
 * what proves the data layer is genuinely wired rather than merely migrated.
 * It is replaced by the real catalogue API in step 4.
 */
@ApiTags('meta')
@Controller('meta/catalog')
export class CatalogStatsController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Row counts and a sample of the seeded catalogue' })
  async stats() {
    if (!this.db.configured) {
      return { configured: false };
    }

    const [counts] = await this.db.query<{
      categories: string;
      brands: string;
      master_parts: string;
      products: string;
      partners: string;
      offers: string;
      vehicles: string;
      fitments: string;
      open_conflicts: string;
      in_stock_offers: string;
    }>(`
      SELECT (SELECT count(*) FROM categories)::text               AS categories,
             (SELECT count(*) FROM brands)::text                   AS brands,
             (SELECT count(*) FROM master_parts)::text             AS master_parts,
             (SELECT count(*) FROM products)::text                 AS products,
             (SELECT count(*) FROM partners)::text                 AS partners,
             (SELECT count(*) FROM offers)::text                   AS offers,
             (SELECT count(*) FROM vehicle_configurations)::text   AS vehicles,
             (SELECT count(*) FROM fitments)::text                 AS fitments,
             (SELECT count(*) FROM fitment_conflicts
               WHERE status = 'OPEN')::text                        AS open_conflicts,
             (SELECT count(*) FROM offers
               WHERE availability_status = 'IN_STOCK')::text       AS in_stock_offers
    `);

    const vehicles = await this.db.query<{
      make: string;
      model: string;
      model_year: number;
      engine_code: string | null;
      market: string | null;
    }>(
      `SELECT make, model, model_year, engine_code, market
       FROM vehicle_configurations ORDER BY make, model LIMIT 12`,
    );

    // The same product across partners: the price comparison the product is
    // built around (PRD §31). Picking a product that several partners carry.
    const comparison = await this.db.query<{
      product: string;
      partner: string;
      city: string;
      customer_price_minor: string;
      currency: string;
      availability_status: string;
      stock_age_minutes: number;
    }>(`
      WITH busiest AS (
        SELECT product_id FROM offers
        GROUP BY product_id HAVING count(*) >= 3
        ORDER BY product_id LIMIT 1
      )
      SELECT p.name AS product,
             pa.display_name AS partner,
             pl.city,
             o.customer_price_minor::text,
             o.currency,
             o.availability_status,
             EXTRACT(EPOCH FROM (now() - o.last_synced_at))::int / 60 AS stock_age_minutes
      FROM offers o
      JOIN busiest b ON b.product_id = o.product_id
      JOIN products p ON p.id = o.product_id
      JOIN partners pa ON pa.id = o.partner_id
      LEFT JOIN partner_locations pl ON pl.id = o.location_id
      ORDER BY o.customer_price_minor
    `);

    return {
      configured: true,
      counts: Object.fromEntries(
        Object.entries(counts ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
      vehicles,
      comparison,
    };
  }
}
