import { Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  ErrorCode,
  VinNotDecodableError,
  maskVin,
  normalizeVin,
  validateVin,
  vinWmi,
  type ClarificationQuestion,
  type VehicleConfiguration,
} from '@autoparts/core';
import type { FitmentProviderChain } from '@autoparts/providers';
import { DatabaseService } from '../../database/database.module.js';
import { VinCryptoService } from './vin-crypto.service.js';
import { FITMENT_PROVIDER_CHAIN } from './providers.provider.js';
import { Inject } from '@nestjs/common';

export interface DecodeResult {
  configurationId: string;
  vinMasked: string;
  configuration: VehicleConfiguration;
  provider: string;
  /** True when the VIN's check digit failed but a provider still identified it. */
  checksumSuspect: boolean;
  /** True when this came from our own store rather than a provider call. */
  fromCache: boolean;
  clarifications: ClarificationQuestion[];
}

/** Falls back to a fully masked placeholder if the stored VIN is unreadable. */
function maskStoredVin(vin: string | null): string {
  return vin ? maskVin(vin) : '*'.repeat(17);
}

@Injectable()
export class VinService {
  private readonly logger = new Logger('VinService');

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: VinCryptoService,
    @Inject(FITMENT_PROVIDER_CHAIN) private readonly chain: FitmentProviderChain,
  ) {}

  /**
   * VIN → vehicle configuration.
   *
   * Our own store is consulted first. That is not an optimisation: PRD §96
   * requires that critical data not depend on a single external provider, so a
   * decoded configuration lives in our database and a provider outage cannot
   * empty anyone's garage. It also means a VIN is paid for at most once, no
   * matter how many users own that car (ADR-003).
   */
  async decode(rawVin: string): Promise<DecodeResult> {
    const vin = normalizeVin(rawVin);
    const validation = validateVin(vin);

    if (!validation.structurallyValid) {
      throw new AppError({
        code: ErrorCode.VIN_INVALID,
        status: 400,
        message: `VIN is not valid: ${validation.reason}`,
        messageKey:
          validation.reason === 'LENGTH' ? 'error.vin.length' : 'error.vin.characters',
        details: { reason: validation.reason },
      });
    }

    const vinHash = this.crypto.hash(vin);

    const cached = await this.findCached(vinHash);
    if (cached) return { ...cached, checksumSuspect: validation.checksumValid === false };

    let decoded;
    try {
      decoded = await this.chain.decodeVin(vin);
    } catch (error) {
      if (error instanceof VinNotDecodableError) {
        throw new AppError({
          code: ErrorCode.VIN_NOT_DECODED,
          status: 422,
          message: error.message,
          messageKey: 'error.vin.notDecoded',
          // The masked VIN is safe to echo; the full one is not.
          details: { vinMasked: error.vinMasked, canEnterManually: true },
        });
      }
      throw error;
    }

    const configurationId = await this.persist(vin, vinHash, decoded);

    this.logger.log(
      JSON.stringify({
        event: 'vin_decoded',
        provider: decoded.provider,
        attempts: decoded.attempts,
        vinMasked: maskVin(vin),
      }),
    );

    return {
      configurationId,
      vinMasked: maskVin(vin),
      configuration: decoded.configuration,
      provider: decoded.provider,
      checksumSuspect: decoded.checksumSuspect,
      fromCache: false,
      clarifications: decoded.clarifications,
    };
  }

  private async findCached(vinHash: Buffer): Promise<DecodeResult | null> {
    const [row] = await this.db.query<{
      id: string;
      provider: string;
      make: string;
      model: string;
      model_year: number;
      generation: string | null;
      engine: string | null;
      engine_code: string | null;
      fuel_type: string | null;
      transmission: string | null;
      drive_type: string | null;
      body_type: string | null;
      trim: string | null;
      market: string | null;
      clarifications: ClarificationQuestion[] | null;
      vin_enc: Buffer;
    }>(
      `SELECT c.id, c.provider, c.make, c.model, c.model_year, c.generation, c.engine,
              c.engine_code, c.fuel_type, c.transmission, c.drive_type, c.body_type,
              c.trim, c.market, c.clarifications, v.vin_enc
       FROM vins v
       JOIN vehicle_configurations c ON c.vin_id = v.id
       WHERE v.vin_hash = $1
       ORDER BY c.decoded_at DESC
       LIMIT 1`,
      [vinHash],
    );

    if (!row) return null;

    return {
      configurationId: row.id,
      vinMasked: maskStoredVin(this.crypto.decrypt(row.vin_enc)),
      configuration: {
        make: row.make,
        model: row.model,
        modelYear: row.model_year,
        generation: row.generation,
        engine: row.engine,
        engineCode: row.engine_code,
        fuelType: row.fuel_type,
        transmission: row.transmission,
        driveType: row.drive_type,
        bodyType: row.body_type,
        trim: row.trim,
        market: row.market as VehicleConfiguration['market'],
      },
      provider: row.provider,
      checksumSuspect: false,
      fromCache: true,
      // Replayed rather than dropped: an unanswered question leaves the vehicle
      // under-specified, and every part that depends on that attribute then
      // comes back UNCERTAIN (docs/05 §4 step 2).
      clarifications: row.clarifications ?? [],
    };
  }

  private async persist(
    vin: string,
    vinHash: Buffer,
    decoded: {
      configuration: VehicleConfiguration;
      provider: string;
      providerRef?: string | null;
      clarifications: ClarificationQuestion[];
      raw: Record<string, unknown>;
    },
  ): Promise<string> {
    const [vinRow] = await this.db.query<{ id: string }>(
      `INSERT INTO vins (vin_hash, vin_enc, wmi)
       VALUES ($1, $2, $3)
       ON CONFLICT (vin_hash) DO UPDATE SET wmi = EXCLUDED.wmi
       RETURNING id`,
      [vinHash, this.crypto.encrypt(vin), vinWmi(vin)],
    );
    if (!vinRow) throw new Error('Failed to store VIN');

    const c = decoded.configuration;
    const [configRow] = await this.db.query<{ id: string }>(
      `INSERT INTO vehicle_configurations
         (vin_id, provider, provider_ref, make, model, model_year, generation, engine,
          engine_code, fuel_type, transmission, drive_type, body_type, trim, market,
          clarifications, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        vinRow.id,
        decoded.provider,
        decoded.providerRef ?? null,
        c.make,
        c.model,
        c.modelYear,
        c.generation ?? null,
        c.engine ?? null,
        c.engineCode ?? null,
        c.fuelType ?? null,
        c.transmission ?? null,
        c.driveType ?? null,
        c.bodyType ?? null,
        c.trim ?? null,
        c.market ?? null,
        JSON.stringify(decoded.clarifications),
        JSON.stringify(decoded.raw),
      ],
    );
    if (!configRow) throw new Error('Failed to store vehicle configuration');
    return configRow.id;
  }
}
