import type {
  ProviderCapabilities,
  VehicleConfiguration,
  VinDecodeResult,
} from '@autoparts/core';

/**
 * The single seam between the product and every external vehicle-data source
 * (PRD §102, docs/02 §4).
 *
 * Nothing above this interface knows which provider answered. That is what lets
 * development proceed on a mock while the commercial contract is still open
 * (PRD §101) and what makes adding TecDoc later one new class rather than a
 * rewrite (docs/05 §11).
 */
export interface FitmentProvider {
  readonly name: string;

  decodeVin(vin: string): Promise<VinDecodeResult>;

  capabilities(): ProviderCapabilities;

  /**
   * Whether this provider is worth calling for this VIN at all. Checked before
   * the call so a paid provider is not spent on a VIN it cannot decode
   * (docs/02 §4.1).
   */
  supports(vin: string): boolean;
}

/** Parts linkage — only implemented by providers with a catalogue licence. */
export interface PartLinkageProvider extends FitmentProvider {
  getCompatibleParts(config: VehicleConfiguration, query: PartQuery): Promise<PartRef[]>;
  getPartDetails(ref: PartRef): Promise<PartDetails>;
}

export interface PartQuery {
  categorySlug?: string;
  masterPartKey?: string;
  limit?: number;
}

export interface PartRef {
  providerPartId: string;
  oem?: string | null;
  brand?: string | null;
}

export interface PartDetails extends PartRef {
  name: string;
  specifications: Record<string, unknown>;
}

export function hasPartLinkage(p: FitmentProvider): p is PartLinkageProvider {
  return p.capabilities().hasPartLinkage;
}
