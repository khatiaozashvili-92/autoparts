import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FitmentVerdict, isSellable, type ClarificationQuestion } from '@autoparts/core';
import {
  FitmentEngine,
  type FitmentRecord,
  type FitmentResult,
  type ProductForFitment,
  type VehicleForFitment,
} from '@autoparts/fitment';
import { DatabaseService } from '../../database/database.module.js';
import type { AppConfig } from '../../config/configuration.js';

export interface EvaluatedProduct {
  productId: string;
  result: FitmentResult;
}

/** Questions the engine is allowed to ask, keyed by the attribute they fill. */
const CLARIFICATIONS: Record<string, ClarificationQuestion> = {
  brake_config: {
    id: 'brake_config',
    questionKey: 'vin.clarify.brakeConfig',
    attribute: 'brake_config',
    options: [
      { value: 'STANDARD', labelKey: 'brake.standard' },
      { value: 'M_SPORT', labelKey: 'brake.mSport' },
    ],
  },
};

/**
 * The database-facing half of the Fitment Engine.
 *
 * The decision logic itself lives in `@autoparts/fitment` and knows nothing
 * about SQL. This service loads what the engine needs, runs it, and records
 * what it decided — the recording is not optional telemetry: without
 * `fitment_checks` the "Fitment Accuracy" KPI, the product's first priority,
 * cannot be measured at all (docs/01 §8).
 */
@Injectable()
export class FitmentService {
  private readonly logger = new Logger('FitmentService');
  private readonly engine: FitmentEngine;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.engine = new FitmentEngine({
      minConfidence: config.get('FITMENT_MIN_CONFIDENCE', { infer: true }),
      clarifications: CLARIFICATIONS,
    });
  }

  /**
   * Evaluates products against a vehicle and returns only what may be sold.
   *
   * R1 (PRD §97) is enforced here rather than left to each caller: the filtered
   * list is the only way results reach a client, so an UNCERTAIN product cannot
   * leak into a search page by omission.
   */
  async evaluateForVehicle(
    vehicleId: string,
    productIds: string[],
    options: { logChecks?: boolean } = {},
  ): Promise<Map<string, FitmentResult>> {
    if (productIds.length === 0) return new Map();

    const vehicle = await this.loadVehicle(vehicleId);
    if (!vehicle) return new Map();

    const products = await this.loadProducts(productIds);
    const results = this.engine.evaluateBatch(vehicle.forFitment, products);

    if (options.logChecks !== false) {
      await this.recordChecks(vehicle.id, vehicle.configurationId, results);
    }
    await this.recordConflicts(vehicle.configurationId, results);

    return results;
  }

  async evaluateOne(vehicleId: string, productId: string): Promise<FitmentResult | null> {
    const results = await this.evaluateForVehicle(vehicleId, [productId]);
    return results.get(productId) ?? null;
  }

  /** Product ids that may be shown for this vehicle (EXACT | COMPATIBLE | CONDITIONAL). */
  async filterSellable(vehicleId: string, productIds: string[]): Promise<Set<string>> {
    const results = await this.evaluateForVehicle(vehicleId, productIds);
    const allowed = new Set<string>();
    for (const [productId, result] of results) {
      if (isSellable(result.verdict)) allowed.add(productId);
    }
    return allowed;
  }

  private async loadVehicle(vehicleId: string): Promise<
    { id: string; configurationId: string | null; forFitment: VehicleForFitment } | null
  > {
    const [row] = await this.db.query<{
      id: string;
      configuration_id: string | null;
      verified_data: Record<string, unknown>;
      user_supplied_data: Record<string, unknown>;
      make: string | null;
      model: string | null;
      model_year: number | null;
      generation: string | null;
      engine: string | null;
      engine_code: string | null;
      fuel_type: string | null;
      transmission: string | null;
      drive_type: string | null;
      body_type: string | null;
      trim: string | null;
      market: string | null;
      production_from: Date | null;
    }>(
      `SELECT v.id, v.configuration_id, v.verified_data, v.user_supplied_data,
              c.make, c.model, c.model_year, c.generation, c.engine, c.engine_code,
              c.fuel_type, c.transmission, c.drive_type, c.body_type, c.trim, c.market,
              c.production_from
       FROM vehicles v
       LEFT JOIN vehicle_configurations c ON c.id = v.configuration_id
       WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [vehicleId],
    );

    if (!row?.make) return null;

    return {
      id: row.id,
      configurationId: row.configuration_id,
      forFitment: {
        configuration: {
          make: row.make,
          model: row.model ?? '',
          modelYear: row.model_year ?? 0,
          generation: row.generation,
          engine: row.engine,
          engineCode: row.engine_code,
          fuelType: row.fuel_type,
          transmission: row.transmission,
          driveType: row.drive_type,
          bodyType: row.body_type,
          trim: row.trim,
          market: row.market as VehicleForFitment['configuration']['market'],
        },
        verifiedData: row.verified_data ?? {},
        userSuppliedData: row.user_supplied_data ?? {},
        productionDate: row.production_from?.toISOString().slice(0, 10) ?? null,
      },
    };
  }

  private async loadProducts(productIds: string[]): Promise<ProductForFitment[]> {
    const rows = await this.db.query<{
      product_id: string;
      category_slug: string;
      required_vehicle_attributes: string[];
      fitments: FitmentRecord[] | null;
      partner_reliability: Record<string, number> | null;
    }>(
      `SELECT p.id AS product_id,
              cat.slug AS category_slug,
              cat.required_vehicle_attributes,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                    'id', f.id, 'productId', f.product_id, 'source', f.source,
                    'partnerId', f.partner_id, 'make', f.make, 'model', f.model,
                    'yearFrom', f.year_from, 'yearTo', f.year_to,
                    'generation', f.generation, 'engineCode', f.engine_code,
                    'transmission', f.transmission, 'driveType', f.drive_type,
                    'bodyType', f.body_type, 'trim', f.trim, 'market', f.market,
                    'productionFrom', f.production_from, 'productionTo', f.production_to,
                    'axle', f.axle, 'position', f.position,
                    'conditions', f.conditions, 'verdict', f.verdict,
                    'confidence', f.confidence))
                 FROM fitments f
                 WHERE f.product_id = p.id AND f.active),
                '[]'::jsonb) AS fitments,
              COALESCE(
                (SELECT jsonb_object_agg(pa.id::text, pa.stock_reliability)
                 FROM partners pa
                 WHERE pa.id IN (SELECT f2.partner_id FROM fitments f2
                                 WHERE f2.product_id = p.id AND f2.partner_id IS NOT NULL)),
                '{}'::jsonb) AS partner_reliability
       FROM products p
       JOIN master_parts mp ON mp.id = p.master_part_id
       JOIN categories cat ON cat.id = mp.category_id
       WHERE p.id = ANY($1::uuid[])`,
      [productIds],
    );

    return rows.map((row) => ({
      id: row.product_id,
      categorySlug: row.category_slug,
      requiredVehicleAttributes: row.required_vehicle_attributes ?? [],
      fitments: (row.fitments ?? []).map((f) => ({
        ...f,
        confidence: Number(f.confidence),
      })),
      partnerReliability: Object.fromEntries(
        Object.entries(row.partner_reliability ?? {}).map(([k, v]) => [k, Number(v)]),
      ),
    }));
  }

  private async recordChecks(
    vehicleId: string,
    configurationId: string | null,
    results: Map<string, FitmentResult>,
  ): Promise<void> {
    const entries = [...results.entries()];
    if (entries.length === 0) return;

    // One statement for the whole batch: a search evaluates a hundred products
    // and a round-trip each would dominate the response time.
    await this.db.query(
      `INSERT INTO fitment_checks
         (vehicle_id, configuration_id, product_id, verdict, winning_source, confidence, reasons)
       SELECT $1, $2, x.product_id::uuid, x.verdict::fitment_verdict,
              x.winning_source::fitment_source, x.confidence::numeric, x.reasons
       FROM jsonb_to_recordset($3::jsonb)
         AS x(product_id text, verdict text, winning_source text,
              confidence numeric, reasons jsonb)`,
      [
        vehicleId,
        configurationId,
        JSON.stringify(
          entries.map(([productId, result]) => ({
            product_id: productId,
            verdict: result.verdict,
            // A verdict reached with no candidate has no source; attribute it to
            // the weakest rather than inventing one.
            winning_source: result.winningSource ?? 'TECHNICAL_DATA',
            confidence: result.confidence,
            reasons: result.reasons,
          })),
        ),
      ],
    );
  }

  /**
   * Opens a conflict row the first time a claim collides with an authority.
   *
   * Idempotent per product × configuration × partner: a search that runs a
   * thousand times must not open a thousand identical tickets for the admin.
   */
  private async recordConflicts(
    configurationId: string | null,
    results: Map<string, FitmentResult>,
  ): Promise<void> {
    for (const [productId, result] of results) {
      if (!result.conflict) continue;
      await this.db.query(
        `INSERT INTO fitment_conflicts
           (product_id, configuration_id, partner_id, claimed_verdict,
            provider_verdict, provider_name, status)
         SELECT $1, $2, $3, $4::fitment_verdict, $5::fitment_verdict, $6, 'OPEN'
         WHERE NOT EXISTS (
           SELECT 1 FROM fitment_conflicts
           WHERE product_id = $1
             AND configuration_id IS NOT DISTINCT FROM $2
             AND partner_id IS NOT DISTINCT FROM $3
             AND status = 'OPEN')`,
        [
          productId,
          configurationId,
          result.conflict.partnerId,
          result.conflict.claimedVerdict,
          result.conflict.providerVerdict,
          result.conflict.providerSource,
        ],
      );
      this.logger.warn(
        JSON.stringify({ event: 'fitment_conflict', productId, configurationId }),
      );
    }
  }
}

export { FitmentVerdict };
