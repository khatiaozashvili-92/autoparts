/**
 * Vehicle domain types, shared by the API, the providers and the clients.
 */

/** Market/region a vehicle was built for. Decisive for fitment (docs/05 §4.1). */
export type Market = 'US' | 'EU' | 'JP' | 'ME' | 'CN' | 'OTHER';

export interface VehicleConfiguration {
  make: string;
  model: string;
  modelYear: number;
  generation?: string | null;
  engine?: string | null;
  engineCode?: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  driveType?: string | null;
  bodyType?: string | null;
  trim?: string | null;
  market?: Market | null;
  productionFrom?: string | null;
  productionTo?: string | null;
}

/**
 * A question asked only when automatic identification is not enough (PRD §10).
 *
 * `askedBecause` exists so the UI can justify the interruption, and so the
 * engine can avoid asking at all when the answer would unlock only one product
 * — a question that buys nothing is pure UX cost (docs/05 §7).
 */
export interface ClarificationQuestion {
  id: string;
  questionKey: string;
  attribute: string;
  options: { value: string; labelKey: string }[];
  askedBecause?: { productIds: string[]; blockedCount: number };
}

export interface VinDecodeResult {
  configuration: VehicleConfiguration;
  provider: string;
  providerRef?: string | null;
  clarifications: ClarificationQuestion[];
  /** Raw provider payload, kept for auditing and re-processing. */
  raw: Record<string, unknown>;
}

export interface ProviderCapabilities {
  /** Markets this provider can decode. Checked before spending a call. */
  markets: Market[];
  hasEngineCode: boolean;
  hasTrim: boolean;
  hasProductionDate: boolean;
  /** Whether the provider can link parts to vehicles. False for NHTSA vPIC. */
  hasPartLinkage: boolean;
  /** Minor units per call, or null when free. */
  costPerCallMinor: number | null;
}

export class VinNotDecodableError extends Error {
  constructor(
    readonly vinMasked: string,
    readonly provider: string,
    message = 'Vehicle could not be identified from this VIN.',
  ) {
    super(message);
    this.name = 'VinNotDecodableError';
  }
}
