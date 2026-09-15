import type {
  ClarificationQuestion,
  FitmentSource,
  FitmentVerdict,
  Market,
  VehicleConfiguration,
} from '@autoparts/core';

/**
 * One claim that a product fits a set of vehicles.
 *
 * A `null` criterion means "any". `market` is the exception — see
 * `matchesCriteria` in engine.ts for why it is treated asymmetrically.
 */
export interface FitmentRecord {
  id: string;
  productId: string;
  source: FitmentSource;
  partnerId?: string | null;

  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  generation?: string | null;
  engineCode?: string | null;
  transmission?: string | null;
  driveType?: string | null;
  bodyType?: string | null;
  trim?: string | null;
  market?: Market | string | null;
  productionFrom?: string | null;
  productionTo?: string | null;
  axle?: string | null;
  position?: string | null;

  /** Extra requirements, e.g. `{ "brake_config": "M_SPORT" }`. */
  conditions: Record<string, unknown>;
  verdict: FitmentVerdict;
  confidence: number;
}

export interface VehicleForFitment {
  configuration: VehicleConfiguration;
  /** Attributes a provider confirmed. */
  verifiedData: Record<string, unknown>;
  /** Attributes the owner supplied. Weighted lower — it is a claim, not a fact. */
  userSuppliedData: Record<string, unknown>;
  /** Production date, when known, for date-bounded fitments. */
  productionDate?: string | null;
}

export interface ProductForFitment {
  id: string;
  categorySlug: string;
  /** Attributes the engine needs before it can decide in this category. */
  requiredVehicleAttributes: string[];
  fitments: FitmentRecord[];
  /** Reliability of the partner behind a PARTNER_DECLARED claim, 0..1. */
  partnerReliability?: Record<string, number>;
}

export type ReasonCode =
  | 'ADMIN_OVERRIDE'
  | 'MISSING_ATTRIBUTES'
  | 'NO_CANDIDATES'
  | 'CRITERIA_MATCH'
  | 'CRITERIA_MISMATCH'
  | 'MARKET_MISMATCH'
  | 'MARKET_UNKNOWN'
  | 'CONFLICT'
  | 'CONDITION_MET_VERIFIED'
  | 'CONDITION_MET_USER'
  | 'CONDITION_UNANSWERED'
  | 'BELOW_CONFIDENCE_THRESHOLD'
  | 'WINNER';

export interface FitmentReason {
  code: ReasonCode;
  detail?: string;
  fitmentId?: string;
  source?: FitmentSource;
}

export interface FitmentResult {
  verdict: FitmentVerdict;
  confidence: number;
  winningSource: FitmentSource | null;
  /** The chain of decisions, for debugging and for the admin conflict screen. */
  reasons: FitmentReason[];
  missingAttributes?: string[];
  clarification?: ClarificationQuestion;
  conflict?: {
    fitmentId: string;
    partnerId?: string | null;
    claimedVerdict: FitmentVerdict;
    providerVerdict: FitmentVerdict;
    providerSource: FitmentSource;
  };
}

export interface EngineOptions {
  /** Below this, a verdict becomes UNCERTAIN and the product is hidden. */
  minConfidence?: number;
  /** Questions the engine may offer, keyed by attribute name. */
  clarifications?: Record<string, ClarificationQuestion>;
}
