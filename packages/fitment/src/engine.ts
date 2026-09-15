import {
  FITMENT_SOURCE_PRIORITY,
  FitmentSource,
  FitmentVerdict,
  type ClarificationQuestion,
} from '@autoparts/core';
import type {
  EngineOptions,
  FitmentReason,
  FitmentRecord,
  FitmentResult,
  ProductForFitment,
  VehicleForFitment,
} from './types.js';

/**
 * The Fitment Engine (docs/05).
 *
 * Answers one question: does this product fit this vehicle?
 *
 * The engine is asymmetric by design — "I don't know" resolves to "no", never
 * to "yes" (PRD §18, §97). The cost of that choice is fewer products shown; the
 * cost of the opposite choice is the wrong part sold, which PRD §2 names as the
 * central risk. Erring towards showing nothing is erring in the right direction.
 *
 * Pure: no database, no HTTP, no framework. That keeps the rule set testable in
 * thousands of cases per second and lets the same logic run on a client later.
 */

export const DEFAULT_MIN_CONFIDENCE = 0.5;

/** Base confidence by source (docs/05 §5). */
const BASE_CONFIDENCE: Record<FitmentSource, number> = {
  ADMIN_MANUAL: 1.0,
  PROVIDER_VIN: 0.98,
  PROVIDER_CONFIG: 0.9,
  OEM_MATCH: 0.85,
  TECHNICAL_DATA: 0.6,
  PARTNER_DECLARED: 0.55,
};

const USER_SUPPLIED_PENALTY = 0.8;
const UNKNOWN_MARKET_PENALTY = 0.85;
const LOW_RELIABILITY_PARTNER = 0.9;

export class FitmentEngine {
  private readonly minConfidence: number;
  private readonly clarifications: Record<string, ClarificationQuestion>;

  constructor(options: EngineOptions = {}) {
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.clarifications = options.clarifications ?? {};
  }

  evaluate(vehicle: VehicleForFitment, product: ProductForFitment): FitmentResult {
    const reasons: FitmentReason[] = [];

    // 1. An admin mapping is human-verified knowledge, usually created because
    //    a provider was wrong. It outranks everything (docs/05 §3.1).
    const adminRecord = product.fitments.find(
      (f) => f.source === FitmentSource.ADMIN_MANUAL && matchesCriteria(vehicle, f).matched,
    );
    if (adminRecord) {
      reasons.push({
        code: 'ADMIN_OVERRIDE',
        fitmentId: adminRecord.id,
        source: FitmentSource.ADMIN_MANUAL,
      });
      return {
        verdict: adminRecord.verdict,
        confidence: 1,
        winningSource: FitmentSource.ADMIN_MANUAL,
        reasons,
      };
    }

    // 2. Is enough known about the vehicle to decide in this category at all?
    const missing = this.missingAttributes(vehicle, product);
    if (missing.length > 0) {
      reasons.push({ code: 'MISSING_ATTRIBUTES', detail: missing.join(', ') });
      const question = this.clarifications[missing[0]!];
      return {
        verdict: FitmentVerdict.UNCERTAIN,
        confidence: 0,
        winningSource: null,
        reasons,
        missingAttributes: missing,
        ...(question ? { clarification: question } : {}),
      };
    }

    // 3. Candidates whose criteria the vehicle satisfies.
    const candidates: { record: FitmentRecord; marketUnknown: boolean }[] = [];
    for (const record of product.fitments) {
      if (record.source === FitmentSource.ADMIN_MANUAL) continue;
      const match = matchesCriteria(vehicle, record);
      if (match.matched) {
        candidates.push({ record, marketUnknown: match.marketUnknown });
        reasons.push({ code: 'CRITERIA_MATCH', fitmentId: record.id, source: record.source });
      } else if (match.reason) {
        reasons.push({ code: match.reason, fitmentId: record.id, detail: match.detail ?? '' });
      }
    }

    if (candidates.length === 0) {
      reasons.push({ code: 'NO_CANDIDATES' });
      return {
        verdict: FitmentVerdict.NOT_COMPATIBLE,
        confidence: 0,
        winningSource: null,
        reasons,
      };
    }

    // 4. A trusted source saying "no" against a weaker source saying "yes" is a
    //    conflict, not a debate (PRD §17). The product is hidden immediately and
    //    an admin decides later.
    const conflict = detectConflict(candidates.map((c) => c.record));
    if (conflict) {
      reasons.push({
        code: 'CONFLICT',
        fitmentId: conflict.claim.id,
        detail: `${conflict.claim.source} says ${conflict.claim.verdict}, ${conflict.authority.source} says ${conflict.authority.verdict}`,
      });
      return {
        verdict: FitmentVerdict.NOT_COMPATIBLE,
        confidence: 0,
        winningSource: conflict.authority.source,
        reasons,
        conflict: {
          fitmentId: conflict.claim.id,
          partnerId: conflict.claim.partnerId ?? null,
          claimedVerdict: conflict.claim.verdict,
          providerVerdict: conflict.authority.verdict,
          providerSource: conflict.authority.source,
        },
      };
    }

    // 5. Highest priority wins; confidence breaks ties.
    const winner = [...candidates].sort((a, b) => {
      const byPriority =
        FITMENT_SOURCE_PRIORITY[a.record.source] - FITMENT_SOURCE_PRIORITY[b.record.source];
      if (byPriority !== 0) return byPriority;
      return b.record.confidence - a.record.confidence;
    })[0]!;

    reasons.push({
      code: 'WINNER',
      fitmentId: winner.record.id,
      source: winner.record.source,
    });

    return this.finalise(vehicle, product, winner.record, winner.marketUnknown, reasons);
  }

  evaluateBatch(
    vehicle: VehicleForFitment,
    products: ProductForFitment[],
  ): Map<string, FitmentResult> {
    const out = new Map<string, FitmentResult>();
    for (const product of products) out.set(product.id, this.evaluate(vehicle, product));
    return out;
  }

  /** Which required attributes this vehicle cannot supply from either source. */
  missingAttributes(vehicle: VehicleForFitment, product: ProductForFitment): string[] {
    return product.requiredVehicleAttributes.filter(
      (attr) => resolveAttribute(vehicle, attr) === null,
    );
  }

  private finalise(
    vehicle: VehicleForFitment,
    product: ProductForFitment,
    record: FitmentRecord,
    marketUnknown: boolean,
    reasons: FitmentReason[],
  ): FitmentResult {
    let confidence = BASE_CONFIDENCE[record.source] ?? record.confidence;

    // The stored confidence narrows the source default but never raises it: a
    // partner cannot promote its own claim by declaring high confidence.
    confidence = Math.min(confidence, record.confidence || confidence);

    if (record.source === FitmentSource.PARTNER_DECLARED) {
      const reliability = product.partnerReliability?.[record.partnerId ?? ''] ?? 1;
      if (reliability <= LOW_RELIABILITY_PARTNER) confidence *= reliability;
    }

    if (marketUnknown) confidence *= UNKNOWN_MARKET_PENALTY;

    let verdict = record.verdict;
    let clarification: ClarificationQuestion | undefined;

    const conditionKeys = Object.keys(record.conditions ?? {});
    if (conditionKeys.length > 0) {
      const outcome = this.checkConditions(vehicle, record, reasons);
      if (outcome.status === 'UNANSWERED') {
        verdict = FitmentVerdict.CONDITIONAL;
        clarification = this.clarifications[outcome.attribute!];
      } else if (outcome.status === 'FAILED') {
        return {
          verdict: FitmentVerdict.NOT_COMPATIBLE,
          confidence: 0,
          winningSource: record.source,
          reasons,
        };
      } else if (outcome.status === 'MET_USER') {
        verdict = FitmentVerdict.CONDITIONAL;
        confidence *= USER_SUPPLIED_PENALTY;
      } else {
        verdict =
          record.verdict === FitmentVerdict.CONDITIONAL ? FitmentVerdict.COMPATIBLE : record.verdict;
      }
    }

    confidence = round(confidence);

    // Below the bar, we do not know. Saying so as UNCERTAIN hides the product,
    // which is the whole point of R1.
    if (confidence < this.minConfidence && verdict !== FitmentVerdict.NOT_COMPATIBLE) {
      reasons.push({
        code: 'BELOW_CONFIDENCE_THRESHOLD',
        detail: `${confidence} < ${this.minConfidence}`,
      });
      return {
        verdict: FitmentVerdict.UNCERTAIN,
        confidence,
        winningSource: record.source,
        reasons,
      };
    }

    return {
      verdict,
      confidence,
      winningSource: record.source,
      reasons,
      ...(clarification ? { clarification } : {}),
    };
  }

  private checkConditions(
    vehicle: VehicleForFitment,
    record: FitmentRecord,
    reasons: FitmentReason[],
  ): { status: 'MET_VERIFIED' | 'MET_USER' | 'FAILED' | 'UNANSWERED'; attribute?: string } {
    let usedUserData = false;

    for (const [attribute, expected] of Object.entries(record.conditions)) {
      const verified = vehicle.verifiedData[attribute];
      const supplied = vehicle.userSuppliedData[attribute];

      if (verified !== undefined && verified !== null) {
        if (!sameValue(verified, expected)) return { status: 'FAILED', attribute };
        continue;
      }

      if (supplied !== undefined && supplied !== null) {
        if (!sameValue(supplied, expected)) return { status: 'FAILED', attribute };
        usedUserData = true;
        continue;
      }

      reasons.push({ code: 'CONDITION_UNANSWERED', detail: attribute, fitmentId: record.id });
      return { status: 'UNANSWERED', attribute };
    }

    reasons.push({
      code: usedUserData ? 'CONDITION_MET_USER' : 'CONDITION_MET_VERIFIED',
      fitmentId: record.id,
    });
    return { status: usedUserData ? 'MET_USER' : 'MET_VERIFIED' };
  }
}

/* ───────────────────────── criteria matching ───────────────────────── */

interface MatchOutcome {
  matched: boolean;
  /** True when the fitment names a market but the vehicle's is unknown. */
  marketUnknown: boolean;
  reason?: 'CRITERIA_MISMATCH' | 'MARKET_MISMATCH' | 'MARKET_UNKNOWN';
  detail?: string;
}

const CRITERIA_ATTRIBUTES = [
  ['generation', 'generation'],
  ['engineCode', 'engineCode'],
  ['transmission', 'transmission'],
  ['driveType', 'driveType'],
  ['bodyType', 'bodyType'],
  ['trim', 'trim'],
] as const;

export function matchesCriteria(vehicle: VehicleForFitment, record: FitmentRecord): MatchOutcome {
  const config = vehicle.configuration;

  if (norm(record.make) !== norm(config.make)) {
    return { matched: false, marketUnknown: false, reason: 'CRITERIA_MISMATCH', detail: 'make' };
  }

  if (record.model && norm(record.model) !== norm(config.model)) {
    return { matched: false, marketUnknown: false, reason: 'CRITERIA_MISMATCH', detail: 'model' };
  }

  if (record.yearFrom != null && config.modelYear < record.yearFrom) {
    return { matched: false, marketUnknown: false, reason: 'CRITERIA_MISMATCH', detail: 'year' };
  }
  if (record.yearTo != null && config.modelYear > record.yearTo) {
    return { matched: false, marketUnknown: false, reason: 'CRITERIA_MISMATCH', detail: 'year' };
  }

  // A null criterion means "any", so only stated criteria can disqualify.
  for (const [recordKey, configKey] of CRITERIA_ATTRIBUTES) {
    const expected = record[recordKey];
    if (!expected) continue;
    const actual = config[configKey];
    if (!actual || norm(String(expected)) !== norm(String(actual))) {
      return {
        matched: false,
        marketUnknown: false,
        reason: 'CRITERIA_MISMATCH',
        detail: recordKey,
      };
    }
  }

  // market is asymmetric. Elsewhere "we don't know" means "don't filter"; here
  // it cannot, because US-spec and EU-spec versions of the same model are both
  // on Georgian roads and their parts differ (ADR-003). A fitment that names a
  // market therefore does not match a vehicle whose market is unknown.
  let marketUnknown = false;
  if (record.market) {
    if (!config.market) {
      return {
        matched: false,
        marketUnknown: true,
        reason: 'MARKET_UNKNOWN',
        detail: String(record.market),
      };
    }
    if (norm(String(record.market)) !== norm(String(config.market))) {
      return { matched: false, marketUnknown: false, reason: 'MARKET_MISMATCH', detail: 'market' };
    }
  } else if (!config.market) {
    // Neither side states a market: allowed, but less certain (docs/05 §5).
    marketUnknown = true;
  }

  const produced = vehicle.productionDate;
  if (produced) {
    if (record.productionFrom && produced < record.productionFrom) {
      return { matched: false, marketUnknown, reason: 'CRITERIA_MISMATCH', detail: 'production' };
    }
    if (record.productionTo && produced > record.productionTo) {
      return { matched: false, marketUnknown, reason: 'CRITERIA_MISMATCH', detail: 'production' };
    }
  }

  return { matched: true, marketUnknown };
}

/* ───────────────────────── conflict detection ───────────────────────── */

interface Conflict {
  claim: FitmentRecord;
  authority: FitmentRecord;
}

/**
 * A higher-priority source rejecting what a lower-priority source claims.
 *
 * The reverse is not a conflict: a partner declining to claim a fit that a
 * provider confirms is simply missing data, not a contradiction.
 */
function detectConflict(records: FitmentRecord[]): Conflict | null {
  const rejecting = records.filter((r) => r.verdict === FitmentVerdict.NOT_COMPATIBLE);
  const claiming = records.filter((r) => r.verdict !== FitmentVerdict.NOT_COMPATIBLE);

  for (const authority of rejecting) {
    for (const claim of claiming) {
      if (FITMENT_SOURCE_PRIORITY[authority.source] < FITMENT_SOURCE_PRIORITY[claim.source]) {
        return { claim, authority };
      }
    }
  }
  return null;
}

/* ───────────────────────── helpers ───────────────────────── */

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-_]/g, '');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sameValue(a: unknown, b: unknown): boolean {
  return norm(String(a)) === norm(String(b));
}

/** Verified data wins over the owner's answer; the configuration is the fallback. */
function resolveAttribute(vehicle: VehicleForFitment, attribute: string): unknown {
  const camel = attribute.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const fromConfig = (vehicle.configuration as unknown as Record<string, unknown>)[camel];
  const value =
    vehicle.verifiedData[attribute] ??
    vehicle.verifiedData[camel] ??
    fromConfig ??
    vehicle.userSuppliedData[attribute] ??
    vehicle.userSuppliedData[camel];
  return value === undefined || value === '' ? null : value;
}
