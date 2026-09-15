import { Injectable } from '@nestjs/common';
import { errors, maskVin, type Principal, type VehicleConfiguration } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { VinCryptoService } from './vin-crypto.service.js';

export interface GarageVehicle {
  id: string;
  customName: string | null;
  label: string;
  vinMasked: string | null;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  configuration: VehicleConfiguration | null;
  /** Answers the owner gave, kept apart from what a provider confirmed. */
  userSuppliedData: Record<string, unknown>;
}

interface VehicleRow {
  id: string;
  custom_name: string | null;
  is_default: boolean;
  last_used_at: Date | null;
  created_at: Date;
  user_supplied_data: Record<string, unknown>;
  vin_enc: Buffer | null;
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
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: VinCryptoService,
  ) {}

  async list(principal: Principal): Promise<GarageVehicle[]> {
    const rows = await this.db.query<VehicleRow>(
      `${SELECT_VEHICLE}
       WHERE v.user_id = $1 AND v.deleted_at IS NULL
       ORDER BY v.is_default DESC, v.last_used_at DESC NULLS LAST, v.created_at`,
      [principal.userId],
    );
    return rows.map((row) => this.toGarageVehicle(row));
  }

  async get(principal: Principal, id: string): Promise<GarageVehicle> {
    const [row] = await this.db.query<VehicleRow>(
      // Scoped by user_id, not merely filtered in the handler: someone else's
      // vehicle must read as absent, never as forbidden (docs/07 §5.1).
      `${SELECT_VEHICLE} WHERE v.id = $1 AND v.user_id = $2 AND v.deleted_at IS NULL`,
      [id, principal.userId],
    );
    if (!row) throw errors.notFound('Vehicle');
    return this.toGarageVehicle(row);
  }

  async add(
    principal: Principal,
    input: {
      configurationId: string;
      customName?: string;
      clarificationAnswers?: Record<string, string>;
    },
  ): Promise<GarageVehicle> {
    const [config] = await this.db.query<{ id: string; vin_id: string | null }>(
      `SELECT id, vin_id FROM vehicle_configurations WHERE id = $1`,
      [input.configurationId],
    );
    if (!config) throw errors.notFound('Vehicle configuration');

    const existing = config.vin_id
      ? await this.db.query<{ id: string }>(
          `SELECT id FROM vehicles
           WHERE user_id = $1 AND vin_id = $2 AND deleted_at IS NULL`,
          [principal.userId, config.vin_id],
        )
      : [];
    if (existing[0]) return this.get(principal, existing[0].id);

    const isFirst = await this.isFirstVehicle(principal.userId);

    const [inserted] = await this.db.query<{ id: string }>(
      `INSERT INTO vehicles (user_id, vin_id, configuration_id, custom_name,
                             user_supplied_data, is_default, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING id`,
      [
        principal.userId,
        config.vin_id,
        config.id,
        input.customName ?? null,
        JSON.stringify(input.clarificationAnswers ?? {}),
        isFirst,
      ],
    );
    if (!inserted) throw errors.internal();

    return this.get(principal, inserted.id);
  }

  async update(
    principal: Principal,
    id: string,
    input: {
      customName?: string | null;
      isDefault?: boolean;
      clarificationAnswers?: Record<string, string>;
    },
  ): Promise<GarageVehicle> {
    await this.get(principal, id); // existence + ownership

    if (input.isDefault) {
      // A partial unique index allows only one default per user, so the old one
      // is cleared first rather than relying on the write to fail.
      await this.db.query(
        `UPDATE vehicles SET is_default = false
         WHERE user_id = $1 AND is_default AND deleted_at IS NULL`,
        [principal.userId],
      );
    }

    await this.db.query(
      `UPDATE vehicles
       SET custom_name = COALESCE($3, custom_name),
           is_default = COALESCE($4, is_default),
           user_supplied_data = CASE
             WHEN $5::jsonb IS NULL THEN user_supplied_data
             ELSE user_supplied_data || $5::jsonb
           END,
           updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        id,
        principal.userId,
        input.customName ?? null,
        input.isDefault ?? null,
        input.clarificationAnswers ? JSON.stringify(input.clarificationAnswers) : null,
      ],
    );

    return this.get(principal, id);
  }

  async remove(principal: Principal, id: string): Promise<void> {
    const vehicle = await this.get(principal, id);

    // Soft delete: order history references the vehicle, and a purchase must
    // still say which car it was for.
    await this.db.query(
      `UPDATE vehicles SET deleted_at = now(), is_default = false
       WHERE id = $1 AND user_id = $2`,
      [id, principal.userId],
    );

    if (vehicle.isDefault) await this.promoteNewDefault(principal.userId);
  }

  async touch(principal: Principal, id: string): Promise<void> {
    await this.db.query(
      `UPDATE vehicles SET last_used_at = now() WHERE id = $1 AND user_id = $2`,
      [id, principal.userId],
    );
  }

  private async isFirstVehicle(userId: string): Promise<boolean> {
    const rows = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM vehicles WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0) === 0;
  }

  /** Keeps a garage from losing its default when the default car is removed. */
  private async promoteNewDefault(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE vehicles SET is_default = true
       WHERE id = (
         SELECT id FROM vehicles
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY last_used_at DESC NULLS LAST, created_at
         LIMIT 1
       )`,
      [userId],
    );
  }

  private toGarageVehicle(row: VehicleRow): GarageVehicle {
    const configuration: VehicleConfiguration | null = row.make
      ? {
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
          market: row.market as VehicleConfiguration['market'],
        }
      : null;

    const derivedLabel = [configuration?.make, configuration?.model, configuration?.modelYear]
      .filter(Boolean)
      .join(' ');
    const label = row.custom_name ?? (derivedLabel || 'Vehicle');

    return {
      id: row.id,
      customName: row.custom_name,
      label,
      // Only ever the masked form leaves the service (docs/07 §7). A row we
      // cannot decrypt yields null rather than failing the whole listing.
      vinMasked: maskStored(row.vin_enc, (b) => this.crypto.decrypt(b)),
      isDefault: row.is_default,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      configuration,
      userSuppliedData: row.user_supplied_data ?? {},
    };
  }
}

function maskStored(
  enc: Buffer | null,
  decrypt: (b: Buffer) => string | null,
): string | null {
  if (!enc) return null;
  const vin = decrypt(enc);
  return vin ? maskVin(vin) : null;
}

const SELECT_VEHICLE = `
  SELECT v.id, v.custom_name, v.is_default, v.last_used_at, v.created_at,
         v.user_supplied_data,
         vin.vin_enc,
         c.make, c.model, c.model_year, c.generation, c.engine, c.engine_code,
         c.fuel_type, c.transmission, c.drive_type, c.body_type, c.trim, c.market
  FROM vehicles v
  LEFT JOIN vins vin ON vin.id = v.vin_id
  LEFT JOIN vehicle_configurations c ON c.id = v.configuration_id
`;
