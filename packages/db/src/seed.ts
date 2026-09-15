import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { normalizeIdentifier, normalizeVin, vinWmi } from '@autoparts/core';
import { BRANDS, CATEGORIES, MASTER_PARTS, PARTNERS, VEHICLES } from './seed-data.js';

/**
 * Deterministic development seed.
 *
 * Idempotent: every insert is an upsert keyed on a natural key, so running it
 * twice changes nothing. That matters because it is run repeatedly during
 * development, and a seed that duplicates rows on the second run is worse than
 * no seed at all.
 */

type Counts = Record<string, number>;

/** Stable ids from a name, so reruns and fixtures reference the same rows. */
function stableId(namespace: string, key: string): string {
  const hash = createHash('sha1').update(`${namespace}:${key}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

const normalizeName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9Ⴀ-ჿ]+/g, '-').replace(/^-|-$/g, '');

/** Deterministic pseudo-random so prices and stock are stable between runs. */
function seededInt(key: string, min: number, max: number): number {
  const hash = createHash('sha1').update(key).digest();
  const value = hash.readUInt32BE(0);
  return min + (value % (max - min + 1));
}

/** Plausible-looking OEM numbers. Format only — not real catalogue data. */
function oemFor(brand: string, partKey: string): string {
  const digits = createHash('sha1').update(`${brand}:${partKey}`).digest('hex');
  const n = BigInt('0x' + digits.slice(0, 12)) % 100000000000n;
  return n.toString().padStart(11, '0');
}

export async function seed(pool: Pool): Promise<Counts> {
  const client = await pool.connect();
  const counts: Counts = {};

  try {
    await client.query('BEGIN');

    counts['categories'] = await seedCategories(client);
    counts['brands'] = await seedBrands(client);
    counts['master_parts'] = await seedMasterParts(client);
    counts['products'] = await seedProducts(client);
    counts['partners'] = await seedPartners(client);
    counts['partner_locations'] = await countOf(client, 'partner_locations');
    counts['price_rules'] = await seedPriceRules(client);
    counts['offers'] = await seedOffers(client);
    counts['vehicle_configurations'] = await seedVehicles(client);
    counts['fitments'] = await seedFitments(client);
    counts['fitment_conflicts'] = await seedConflicts(client);

    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function countOf(c: PoolClient, table: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

async function seedCategories(c: PoolClient): Promise<number> {
  for (const cat of CATEGORIES) {
    const id = stableId('category', cat.slug);
    await c.query(
      `INSERT INTO categories (id, slug, required_vehicle_attributes, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET required_vehicle_attributes = EXCLUDED.required_vehicle_attributes`,
      [id, cat.slug, cat.required, CATEGORIES.indexOf(cat)],
    );
    for (const [locale, name, synonyms] of [
      ['ka', cat.ka, cat.synonymsKa],
      ['en', cat.en, cat.synonymsEn],
    ] as const) {
      await c.query(
        `INSERT INTO category_translations (category_id, locale, name, synonyms)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (category_id, locale) DO UPDATE
           SET name = EXCLUDED.name, synonyms = EXCLUDED.synonyms`,
        [id, locale, name, synonyms],
      );
    }
  }
  return CATEGORIES.length;
}

async function seedBrands(c: PoolClient): Promise<number> {
  for (const brand of BRANDS) {
    await c.query(
      `INSERT INTO brands (id, name, normalized_name, brand_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (normalized_name) DO UPDATE SET brand_type = EXCLUDED.brand_type`,
      [stableId('brand', brand.name), brand.name, normalizeName(brand.name), brand.type],
    );
  }
  return BRANDS.length;
}

async function seedMasterParts(c: PoolClient): Promise<number> {
  for (const part of MASTER_PARTS) {
    const id = stableId('master_part', part.key);
    await c.query(
      `INSERT INTO master_parts (id, category_id, normalized_name, position, axle)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        id,
        stableId('category', part.categorySlug),
        part.key,
        part.position ?? null,
        part.axle ?? null,
      ],
    );
    for (const [locale, name, synonyms] of [
      ['ka', part.ka, part.synonymsKa],
      ['en', part.en, [] as string[]],
    ] as const) {
      await c.query(
        `INSERT INTO master_part_translations (master_part_id, locale, name, synonyms)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (master_part_id, locale) DO UPDATE
           SET name = EXCLUDED.name, synonyms = EXCLUDED.synonyms`,
        [id, locale, name, synonyms],
      );
    }
  }
  return MASTER_PARTS.length;
}

/** Aftermarket brands that plausibly make each kind of part. */
const BRANDS_BY_CATEGORY: Record<string, string[]> = {
  brakes: ['Bosch', 'Brembo', 'TRW'],
  filters: ['Mann-Filter', 'Bosch', 'Denso'],
  engine: ['Bosch', 'NGK', 'Denso'],
  suspension: ['Sachs', 'TRW'],
  electrical: ['Bosch', 'Varta', 'Denso'],
  cooling: ['Valeo', 'Denso'],
  body: ['Pilkington', 'Valeo'],
  lighting: ['Valeo', 'Denso'],
  transmission: ['Sachs', 'Valeo'],
  hvac: ['Denso', 'Valeo'],
  'oils-fluids': ['Bosch', 'No Name'],
};

async function seedProducts(c: PoolClient): Promise<number> {
  let created = 0;

  for (const part of MASTER_PARTS) {
    const brandNames = BRANDS_BY_CATEGORY[part.categorySlug] ?? ['Bosch'];

    for (const brandName of brandNames) {
      const key = `${part.key}:${brandName}`;
      const productId = stableId('product', key);
      const brandId = stableId('brand', brandName);

      await c.query(
        `INSERT INTO products (id, master_part_id, brand_id, name, condition, warranty_months, country_of_origin)
         VALUES ($1, $2, $3, $4, 'NEW', $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          productId,
          stableId('master_part', part.key),
          brandId,
          `${part.en} — ${brandName}`,
          seededInt(`warranty:${key}`, 6, 24),
          'DE',
        ],
      );

      for (const [kind, value] of [
        ['OEM', oemFor(brandName, part.key)],
        ['MPN', `${brandName.slice(0, 3).toUpperCase()}${seededInt(`mpn:${key}`, 10000, 99999)}`],
      ] as const) {
        await c.query(
          `INSERT INTO product_identifiers (id, product_id, kind, value, normalized, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (kind, normalized, product_id) DO NOTHING`,
          [
            stableId('identifier', `${key}:${kind}`),
            productId,
            kind,
            value,
            normalizeIdentifier(value),
            kind === 'OEM',
          ],
        );
      }
      created++;
    }
  }

  return created;
}

async function seedPartners(c: PoolClient): Promise<number> {
  for (const partner of PARTNERS) {
    const partnerId = stableId('partner', partner.legalName);
    await c.query(
      `INSERT INTO partners (id, legal_name, display_name, status, integration_mode,
                             country, currency, contact_email, stock_reliability, approved_at)
       VALUES ($1, $2, $3, 'APPROVED', $4, 'GE', 'GEL', $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET stock_reliability = EXCLUDED.stock_reliability`,
      [
        partnerId,
        partner.legalName,
        partner.displayName,
        partner.mode,
        `info@${normalizeName(partner.displayName)}.ge`,
        partner.reliability,
      ],
    );

    for (const loc of partner.locations) {
      await c.query(
        `INSERT INTO partner_locations (id, partner_id, name, address_line, city, country,
                                        latitude, longitude, working_hours, active)
         VALUES ($1, $2, $3, $4, $5, 'GE', $6, $7, $8, true)
         ON CONFLICT (id) DO NOTHING`,
        [
          stableId('location', `${partner.legalName}:${loc.name}`),
          partnerId,
          loc.name,
          loc.address,
          loc.name.includes('რუსთავი') ? 'რუსთავი' : 'თბილისი',
          loc.lat,
          loc.lon,
          JSON.stringify({
            mon: ['09:00', '19:00'], tue: ['09:00', '19:00'], wed: ['09:00', '19:00'],
            thu: ['09:00', '19:00'], fri: ['09:00', '19:00'], sat: ['10:00', '16:00'],
          }),
        ],
      );
    }
  }
  return PARTNERS.length;
}

async function seedPriceRules(c: PoolClient): Promise<number> {
  // A platform default plus two category overrides — enough to exercise the
  // specificity resolution in docs/08 §3.
  const rules: { partner: string | null; category: string | null; percent: number; priority: number }[] = [
    { partner: null, category: null, percent: 10, priority: 0 },
    { partner: null, category: 'brakes', percent: 8, priority: 1 },
    { partner: null, category: 'electrical', percent: 12, priority: 1 },
    { partner: 'Auto Motors LLC', category: null, percent: 9, priority: 2 },
  ];

  for (const rule of rules) {
    await c.query(
      `INSERT INTO price_rules (id, partner_id, category_id, markup_percent, currency, priority, active)
       VALUES ($1, $2, $3, $4, 'GEL', $5, true)
       ON CONFLICT (id) DO UPDATE SET markup_percent = EXCLUDED.markup_percent`,
      [
        stableId('price_rule', `${rule.partner ?? '*'}:${rule.category ?? '*'}`),
        rule.partner ? stableId('partner', rule.partner) : null,
        rule.category ? stableId('category', rule.category) : null,
        rule.percent,
        rule.priority,
      ],
    );
  }
  return rules.length;
}

async function seedOffers(c: PoolClient): Promise<number> {
  const { rows: products } = await c.query<{ id: string; category_slug: string; part_key: string }>(
    `SELECT p.id, c.slug AS category_slug, mp.normalized_name AS part_key
     FROM products p
     JOIN master_parts mp ON mp.id = p.master_part_id
     JOIN categories c ON c.id = mp.category_id`,
  );

  const markupByCategory: Record<string, number> = { brakes: 8, electrical: 12 };
  let created = 0;

  for (const product of products) {
    for (const partner of PARTNERS) {
      const key = `${product.id}:${partner.legalName}`;
      // Not every partner stocks every part — otherwise comparison is fake.
      if (seededInt(`stocks:${key}`, 0, 100) > 70) continue;

      const partnerId = stableId('partner', partner.legalName);
      const location = partner.locations[seededInt(`loc:${key}`, 0, partner.locations.length - 1)];
      if (!location) continue;

      const base = BigInt(seededInt(`price:${key}`, 1500, 85000));
      const percent = markupByCategory[product.category_slug] ?? 10;
      const markup = (base * BigInt(Math.round(percent * 1000))) / 100000n;

      const roll = seededInt(`avail:${key}`, 0, 100);
      const availability =
        roll < 70 ? 'IN_STOCK' : roll < 92 ? 'AVAILABLE_TO_ORDER' : 'UNAVAILABLE';
      const quantity = availability === 'IN_STOCK' ? seededInt(`qty:${key}`, 1, 12) : 0;

      await c.query(
        `INSERT INTO offers (id, partner_id, product_id, location_id, partner_sku,
                             base_price_minor, platform_markup_minor, currency,
                             stock_quantity, availability_status,
                             expected_availability_days, stock_reliability,
                             last_synced_at, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'GEL',$8,$9,$10,$11,
                 now() - ($12 || ' minutes')::interval, true)
         ON CONFLICT (id) DO UPDATE
           SET base_price_minor = EXCLUDED.base_price_minor,
               platform_markup_minor = EXCLUDED.platform_markup_minor,
               stock_quantity = EXCLUDED.stock_quantity,
               availability_status = EXCLUDED.availability_status`,
        [
          stableId('offer', key),
          partnerId,
          product.id,
          stableId('location', `${partner.legalName}:${location.name}`),
          `SKU-${seededInt(`sku:${key}`, 1000, 9999)}`,
          base.toString(),
          markup.toString(),
          quantity,
          availability,
          availability === 'AVAILABLE_TO_ORDER' ? seededInt(`eta:${key}`, 2, 21) : null,
          partner.reliability,
          // Varied sync ages so the "updated N minutes ago" indicator and the
          // staleness rules of docs/06 §11 have something real to show.
          seededInt(`sync:${key}`, 1, 180),
        ],
      );
      created++;
    }
  }
  return created;
}

async function seedVehicles(c: PoolClient): Promise<number> {
  for (const vehicle of VEHICLES) {
    const vin = normalizeVin(vehicle.vin);
    const vinId = stableId('vin', vin);
    const hash = createHash('sha256').update(vin).digest();

    await c.query(
      `INSERT INTO vins (id, vin_hash, vin_enc, wmi)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vin_hash) DO NOTHING`,
      // Seed data only: a real VIN is encrypted with the KMS key (docs/07 §7).
      [vinId, hash, Buffer.from(vin, 'utf8'), vinWmi(vin)],
    );

    await c.query(
      `INSERT INTO vehicle_configurations
         (id, vin_id, provider, make, model, model_year, generation, engine, engine_code,
          fuel_type, transmission, drive_type, body_type, trim, market, raw)
       VALUES ($1,$2,'mock',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'{}')
       ON CONFLICT (id) DO NOTHING`,
      [
        stableId('config', vin),
        vinId,
        vehicle.make,
        vehicle.model,
        vehicle.year,
        vehicle.generation ?? null,
        vehicle.engine,
        vehicle.engineCode,
        vehicle.fuelType,
        vehicle.transmission,
        vehicle.driveType,
        vehicle.bodyType,
        vehicle.trim ?? null,
        vehicle.market,
      ],
    );
  }
  return VEHICLES.length;
}

async function seedFitments(c: PoolClient): Promise<number> {
  const { rows: products } = await c.query<{ id: string; part_key: string; category_slug: string }>(
    `SELECT p.id, mp.normalized_name AS part_key, c.slug AS category_slug
     FROM products p
     JOIN master_parts mp ON mp.id = p.master_part_id
     JOIN categories c ON c.id = mp.category_id`,
  );

  let created = 0;

  for (const product of products) {
    for (const vehicle of VEHICLES) {
      const key = `${product.id}:${vehicle.vin}`;
      // Roughly a third of vehicle/product pairs get a fitment claim.
      if (seededInt(`fits:${key}`, 0, 100) > 34) continue;

      const part = MASTER_PARTS.find((p) => p.key === product.part_key);
      const roll = seededInt(`src:${key}`, 0, 100);
      const source = roll < 45 ? 'PROVIDER_CONFIG' : roll < 75 ? 'OEM_MATCH' : 'PARTNER_DECLARED';
      const partnerName = PARTNERS[seededInt(`fp:${key}`, 0, PARTNERS.length - 1)]?.legalName;

      await c.query(
        `INSERT INTO fitments (id, product_id, source, partner_id, make, model,
                               year_from, year_to, generation, engine_code, transmission,
                               drive_type, body_type, market, axle, position,
                               verdict, confidence, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true)
         ON CONFLICT (id) DO NOTHING`,
        [
          stableId('fitment', key),
          product.id,
          source,
          source === 'PARTNER_DECLARED' && partnerName ? stableId('partner', partnerName) : null,
          vehicle.make,
          vehicle.model,
          vehicle.year - 2,
          vehicle.year + 2,
          vehicle.generation ?? null,
          source === 'PROVIDER_CONFIG' ? vehicle.engineCode : null,
          null,
          null,
          null,
          vehicle.market,
          part?.axle ?? null,
          part?.position ?? null,
          source === 'PROVIDER_CONFIG' ? 'EXACT' : 'COMPATIBLE',
          source === 'PROVIDER_CONFIG' ? 0.95 : source === 'OEM_MATCH' ? 0.85 : 0.5,
        ],
      );
      created++;
    }
  }
  return created;
}

/**
 * A handful of deliberate conflicts (PRD §17): a partner claims a fit the
 * provider rejects. Without these the admin resolution queue is empty and the
 * flow cannot be exercised before real partner data exists.
 */
async function seedConflicts(c: PoolClient): Promise<number> {
  const { rows } = await c.query<{ id: string; product_id: string; partner_id: string | null }>(
    `SELECT id, product_id, partner_id FROM fitments
     WHERE source = 'PARTNER_DECLARED' AND partner_id IS NOT NULL
     ORDER BY id LIMIT 6`,
  );

  const bmw = stableId('config', normalizeVin(VEHICLES[0]!.vin));

  for (const row of rows) {
    await c.query(
      `INSERT INTO fitment_conflicts (id, product_id, configuration_id, partner_id,
                                      claimed_verdict, provider_verdict, provider_name, status)
       VALUES ($1,$2,$3,$4,'COMPATIBLE','NOT_COMPATIBLE','mock','OPEN')
       ON CONFLICT (id) DO NOTHING`,
      [stableId('conflict', row.id), row.product_id, bmw, row.partner_id],
    );
  }
  return rows.length;
}

export { randomUUID };
