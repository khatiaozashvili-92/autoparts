import {
  VinNotDecodableError,
  maskVin,
  normalizeVin,
  validateVin,
  type ProviderCapabilities,
  type VehicleConfiguration,
  type VinDecodeResult,
} from '@autoparts/core';
import type { FitmentProvider } from './fitment-provider.interface.js';

const DEFAULT_ENDPOINT = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

interface VpicRow {
  Make?: string;
  Model?: string;
  ModelYear?: string;
  Series?: string;
  Trim?: string;
  EngineModel?: string;
  DisplacementL?: string;
  EngineCylinders?: string;
  FuelTypePrimary?: string;
  TransmissionStyle?: string;
  DriveType?: string;
  BodyClass?: string;
  ErrorCode?: string;
  ErrorText?: string;
  [key: string]: string | undefined;
}

/**
 * NHTSA vPIC — free, unlimited, US-market only.
 *
 * Worth a real adapter rather than a curiosity: most used cars in Georgia are
 * imported from US auctions, so vPIC covers a large share of the fleet at zero
 * cost (ADR-003). It cannot link parts to vehicles, so `hasPartLinkage` is
 * false and the fitment engine weights it accordingly.
 */
export class NhtsaVpicProvider implements FitmentProvider {
  readonly name = 'nhtsa_vpic';

  constructor(
    private readonly endpoint: string = DEFAULT_ENDPOINT,
    private readonly timeoutMs = 5000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      markets: ['US'],
      hasEngineCode: false, // vPIC returns a displacement, not a manufacturer engine code
      hasTrim: true,
      hasProductionDate: false,
      hasPartLinkage: false,
      costPerCallMinor: null,
    };
  }

  /**
   * Any structurally valid VIN. Deliberately not narrowed by VIN region.
   *
   * vPIC covers vehicles sold in the US market, which is not the same thing as
   * vehicles built in North America. A BMW assembled in Germany and sold in the
   * US carries a `W` VIN, and gating on the VIN's region would skip it — which
   * would exclude a large share of Georgia's imports, since European brands
   * bought at US auctions are exactly the common case (ADR-003).
   *
   * There is no reliable way to tell a US-market car from its VIN alone, so the
   * call is simply attempted: it is free, and `decodeVin` already rejects the
   * thin result vPIC returns for a vehicle it does not know, rather than
   * storing it as a confidently wrong vehicle.
   */
  supports(vin: string): boolean {
    return validateVin(vin).structurallyValid;
  }

  async decodeVin(vin: string): Promise<VinDecodeResult> {
    const normalized = normalizeVin(vin);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let row: VpicRow;
    try {
      const url = `${this.endpoint}/${encodeURIComponent(normalized)}?format=json`;
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new VinNotDecodableError(
          maskVin(normalized),
          this.name,
          `vPIC returned HTTP ${response.status}`,
        );
      }
      const body = (await response.json()) as { Results?: VpicRow[] };
      const first = body.Results?.[0];
      if (!first) throw new VinNotDecodableError(maskVin(normalized), this.name);
      row = first;
    } finally {
      clearTimeout(timer);
    }

    // vPIC answers 200 with an error code in the body rather than a 4xx.
    const make = clean(row.Make);
    const model = clean(row.Model);
    const year = Number(clean(row.ModelYear) ?? '');

    if (!make || !model || !Number.isFinite(year)) {
      throw new VinNotDecodableError(
        maskVin(normalized),
        this.name,
        row.ErrorText ? `vPIC: ${row.ErrorText}` : 'vPIC returned no usable vehicle data.',
      );
    }

    const configuration: VehicleConfiguration = {
      make,
      model,
      modelYear: year,
      generation: clean(row.Series),
      engine: describeEngine(row),
      engineCode: null,
      fuelType: normalizeFuel(clean(row.FuelTypePrimary)),
      transmission: normalizeTransmission(clean(row.TransmissionStyle)),
      driveType: normalizeDrive(clean(row.DriveType)),
      bodyType: clean(row.BodyClass)?.toUpperCase() ?? null,
      trim: clean(row.Trim),
      market: 'US',
    };

    return {
      configuration,
      provider: this.name,
      providerRef: normalized,
      // vPIC has no notion of an ambiguous configuration; anything it omits is
      // resolved later by the engine asking the owner (docs/05 §7).
      clarifications: [],
      raw: row as Record<string, unknown>,
    };
  }
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Not Applicable') return null;
  return trimmed;
}

function describeEngine(row: VpicRow): string | null {
  const litres = clean(row.DisplacementL);
  const cylinders = clean(row.EngineCylinders);
  const model = clean(row.EngineModel);
  const parts = [
    litres ? `${Number(litres).toFixed(1)}L` : null,
    cylinders ? `${cylinders}cyl` : null,
    model,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function normalizeFuel(value: string | null): string | null {
  if (!value) return null;
  const v = value.toUpperCase();
  if (v.includes('DIESEL')) return 'DIESEL';
  if (v.includes('ELECTRIC')) return 'ELECTRIC';
  if (v.includes('GASOLINE') || v.includes('PETROL')) return 'PETROL';
  return v;
}

function normalizeTransmission(value: string | null): string | null {
  if (!value) return null;
  const v = value.toUpperCase();
  if (v.includes('MANUAL')) return 'MANUAL';
  if (v.includes('CVT') || v.includes('CONTINUOUSLY')) return 'CVT';
  if (v.includes('AUTOMAT')) return 'AUTOMATIC';
  return v;
}

function normalizeDrive(value: string | null): string | null {
  if (!value) return null;
  const v = value.toUpperCase();
  if (v.includes('4WD') || v.includes('4X4')) return '4WD';
  if (v.includes('AWD') || v.includes('ALL-WHEEL')) return 'AWD';
  if (v.includes('REAR')) return 'RWD';
  if (v.includes('FRONT')) return 'FWD';
  return v;
}
