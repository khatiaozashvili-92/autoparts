import {
  VinNotDecodableError,
  maskVin,
  normalizeVin,
  validateVin,
  type ClarificationQuestion,
  type Market,
  type ProviderCapabilities,
  type VehicleConfiguration,
  type VinDecodeResult,
} from '@autoparts/core';
import type { FitmentProvider } from './fitment-provider.interface.js';

export interface MockVehicleRecord extends VehicleConfiguration {
  vin: string;
  /** Questions this vehicle cannot answer from its own data (PRD §10). */
  clarifications?: ClarificationQuestion[];
}

/**
 * In-memory provider used for development, tests and CI (PRD §101).
 *
 * It is deliberately strict: an unknown VIN fails rather than inventing a
 * plausible car. A mock that always succeeds would hide exactly the failure
 * path — "we couldn't identify your vehicle" (PRD §43) — that the real
 * providers hit most often.
 */
export class MockFitmentProvider implements FitmentProvider {
  readonly name = 'mock';

  private readonly byVin = new Map<string, MockVehicleRecord>();

  constructor(records: MockVehicleRecord[] = []) {
    for (const record of records) this.byVin.set(normalizeVin(record.vin), record);
  }

  add(record: MockVehicleRecord): void {
    this.byVin.set(normalizeVin(record.vin), record);
  }

  capabilities(): ProviderCapabilities {
    return {
      markets: ['US', 'EU', 'JP', 'ME', 'CN', 'OTHER'],
      hasEngineCode: true,
      hasTrim: true,
      hasProductionDate: false,
      hasPartLinkage: false,
      costPerCallMinor: null,
    };
  }

  supports(vin: string): boolean {
    return validateVin(vin).structurallyValid;
  }

  async decodeVin(vin: string): Promise<VinDecodeResult> {
    const normalized = normalizeVin(vin);
    const record = this.byVin.get(normalized);

    if (!record) {
      throw new VinNotDecodableError(maskVin(normalized), this.name);
    }

    const { vin: _vin, clarifications, ...configuration } = record;

    return {
      configuration: configuration as VehicleConfiguration,
      provider: this.name,
      providerRef: normalized,
      clarifications: clarifications ?? [],
      raw: { source: 'mock', vin: maskVin(normalized) },
    };
  }
}

/** The brake-configuration question PRD §10 uses as its worked example. */
export const BRAKE_CONFIG_CLARIFICATION: ClarificationQuestion = {
  id: 'brake_config',
  questionKey: 'vin.clarify.brakeConfig',
  attribute: 'brake_config',
  options: [
    { value: 'STANDARD', labelKey: 'brake.standard' },
    { value: 'M_SPORT', labelKey: 'brake.mSport' },
  ],
};

export function marketFromString(value: string | null | undefined): Market | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return (['US', 'EU', 'JP', 'ME', 'CN', 'OTHER'] as const).includes(upper as Market)
    ? (upper as Market)
    : 'OTHER';
}
