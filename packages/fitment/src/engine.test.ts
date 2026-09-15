import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FitmentSource, FitmentVerdict, isSellable } from '@autoparts/core';
import { FitmentEngine } from './engine.js';
import type { FitmentRecord, ProductForFitment, VehicleForFitment } from './types.js';

/* ───────────────────────── fixtures ───────────────────────── */

const bmw228i: VehicleForFitment = {
  configuration: {
    make: 'BMW',
    model: '2 Series',
    modelYear: 2016,
    generation: 'F22',
    engine: '2.0L Turbo',
    engineCode: 'N20B20',
    fuelType: 'PETROL',
    transmission: 'AUTOMATIC',
    driveType: 'RWD',
    bodyType: 'COUPE',
    trim: '228i',
    market: 'US',
  },
  verifiedData: {},
  userSuppliedData: {},
};

let counter = 0;
function fitment(overrides: Partial<FitmentRecord> = {}): FitmentRecord {
  return {
    id: `f${++counter}`,
    productId: 'p1',
    source: FitmentSource.PROVIDER_CONFIG,
    make: 'BMW',
    model: '2 Series',
    yearFrom: 2014,
    yearTo: 2018,
    conditions: {},
    verdict: FitmentVerdict.COMPATIBLE,
    confidence: 0.9,
    ...overrides,
  };
}

function product(fitments: FitmentRecord[], overrides: Partial<ProductForFitment> = {}): ProductForFitment {
  return {
    id: 'p1',
    categorySlug: 'brakes',
    requiredVehicleAttributes: [],
    fitments,
    ...overrides,
  };
}

const engine = new FitmentEngine();

/* ───────────────────────── the core rule ───────────────────────── */

test('a matching provider fitment is compatible', () => {
  const r = engine.evaluate(bmw228i, product([fitment()]));
  assert.equal(r.verdict, FitmentVerdict.COMPATIBLE);
  assert.ok(isSellable(r.verdict));
});

test('no candidate fitment means not compatible, never a guess', () => {
  const r = engine.evaluate(bmw228i, product([fitment({ make: 'Toyota' })]));
  assert.equal(r.verdict, FitmentVerdict.NOT_COMPATIBLE);
  assert.equal(isSellable(r.verdict), false);
});

test('a missing required attribute yields UNCERTAIN, which is not sellable', () => {
  const vehicle: VehicleForFitment = {
    ...bmw228i,
    configuration: { ...bmw228i.configuration, engineCode: null },
  };
  const r = engine.evaluate(
    vehicle,
    product([fitment()], { requiredVehicleAttributes: ['engine_code'] }),
  );
  assert.equal(r.verdict, FitmentVerdict.UNCERTAIN);
  assert.deepEqual(r.missingAttributes, ['engine_code']);
  assert.equal(isSellable(r.verdict), false);
});

test('UNCERTAIN never becomes COMPATIBLE, whatever the inputs', () => {
  // Property check over the shape of the decision: for every combination of a
  // missing required attribute, the answer stays unsellable.
  for (const attr of ['engine_code', 'transmission', 'body_type', 'trim']) {
    const stripped: VehicleForFitment = {
      ...bmw228i,
      configuration: { ...bmw228i.configuration, [camel(attr)]: null },
    };
    const r = engine.evaluate(stripped, product([fitment()], { requiredVehicleAttributes: [attr] }));
    assert.equal(isSellable(r.verdict), false, `${attr} should block the sale`);
  }
});

/* ───────────────────────── priority ───────────────────────── */

test('an admin mapping outranks every provider', () => {
  const r = engine.evaluate(
    bmw228i,
    product([
      fitment({ source: FitmentSource.PROVIDER_VIN, verdict: FitmentVerdict.NOT_COMPATIBLE }),
      fitment({ source: FitmentSource.ADMIN_MANUAL, verdict: FitmentVerdict.COMPATIBLE }),
    ]),
  );
  assert.equal(r.verdict, FitmentVerdict.COMPATIBLE);
  assert.equal(r.winningSource, FitmentSource.ADMIN_MANUAL);
  assert.equal(r.confidence, 1);
});

test('a provider outranks a partner when both agree it fits', () => {
  const r = engine.evaluate(
    bmw228i,
    product([
      fitment({ source: FitmentSource.PARTNER_DECLARED, partnerId: 'pa', confidence: 0.55 }),
      fitment({ source: FitmentSource.PROVIDER_VIN, confidence: 0.98 }),
    ]),
  );
  assert.equal(r.winningSource, FitmentSource.PROVIDER_VIN);
});

test('a partner cannot promote its own claim by declaring high confidence', () => {
  const r = engine.evaluate(
    bmw228i,
    product([fitment({ source: FitmentSource.PARTNER_DECLARED, partnerId: 'pa', confidence: 1 })]),
  );
  // Capped at the source's ceiling, not the partner's self-assessment.
  assert.ok(r.confidence <= 0.55, `confidence was ${r.confidence}`);
});

test('an unreliable partner is discounted further', () => {
  const reliable = engine.evaluate(
    bmw228i,
    product([fitment({ source: FitmentSource.PARTNER_DECLARED, partnerId: 'good', confidence: 0.55 })], {
      partnerReliability: { good: 1 },
    }),
  );
  const unreliable = engine.evaluate(
    bmw228i,
    product([fitment({ source: FitmentSource.PARTNER_DECLARED, partnerId: 'bad', confidence: 0.55 })], {
      partnerReliability: { bad: 0.6 },
    }),
  );
  assert.ok(unreliable.confidence < reliable.confidence);
  // 0.55 * 0.6 = 0.33, below the 0.5 bar, so the product disappears.
  assert.equal(unreliable.verdict, FitmentVerdict.UNCERTAIN);
});

/* ───────────────────────── conflicts (PRD §17) ───────────────────────── */

test('a partner claim against a provider rejection is a conflict, and hides the product', () => {
  const r = engine.evaluate(
    bmw228i,
    product([
      fitment({ source: FitmentSource.PARTNER_DECLARED, partnerId: 'pa', verdict: FitmentVerdict.COMPATIBLE }),
      fitment({ source: FitmentSource.PROVIDER_VIN, verdict: FitmentVerdict.NOT_COMPATIBLE }),
    ]),
  );
  assert.equal(r.verdict, FitmentVerdict.NOT_COMPATIBLE);
  assert.ok(r.conflict, 'a conflict record should be raised for the admin queue');
  assert.equal(r.conflict?.claimedVerdict, FitmentVerdict.COMPATIBLE);
  assert.equal(r.conflict?.providerVerdict, FitmentVerdict.NOT_COMPATIBLE);
  assert.equal(r.conflict?.partnerId, 'pa');
});

test('a weaker source rejecting what a stronger source confirms is not a conflict', () => {
  const r = engine.evaluate(
    bmw228i,
    product([
      fitment({ source: FitmentSource.PROVIDER_VIN, verdict: FitmentVerdict.COMPATIBLE }),
      fitment({ source: FitmentSource.PARTNER_DECLARED, partnerId: 'pa', verdict: FitmentVerdict.NOT_COMPATIBLE }),
    ]),
  );
  assert.equal(r.conflict, undefined);
  assert.equal(r.verdict, FitmentVerdict.COMPATIBLE);
});

/* ───────────────────────── market (ADR-003) ───────────────────────── */

test('a US fitment does not match an EU car of the same model', () => {
  const euCar: VehicleForFitment = {
    ...bmw228i,
    configuration: { ...bmw228i.configuration, market: 'EU' },
  };
  const r = engine.evaluate(euCar, product([fitment({ market: 'US' })]));
  assert.equal(r.verdict, FitmentVerdict.NOT_COMPATIBLE);
});

test('a market-specific fitment does not match a car whose market is unknown', () => {
  // Elsewhere "unknown" means "do not filter". Not here: US-spec and EU-spec
  // versions of the same model both circulate in Georgia and their parts
  // differ, so an unknown market cannot be assumed to match.
  const unknownMarket: VehicleForFitment = {
    ...bmw228i,
    configuration: { ...bmw228i.configuration, market: null },
  };
  const r = engine.evaluate(unknownMarket, product([fitment({ market: 'US' })]));
  assert.equal(r.verdict, FitmentVerdict.NOT_COMPATIBLE);
  assert.ok(r.reasons.some((x) => x.code === 'MARKET_UNKNOWN'));
});

test('when neither side states a market the fit stands but is less certain', () => {
  const unknownMarket: VehicleForFitment = {
    ...bmw228i,
    configuration: { ...bmw228i.configuration, market: null },
  };
  const withMarket = engine.evaluate(bmw228i, product([fitment()]));
  const without = engine.evaluate(unknownMarket, product([fitment({ market: null })]));
  assert.equal(without.verdict, FitmentVerdict.COMPATIBLE);
  assert.ok(without.confidence < withMarket.confidence);
});

/* ───────────────────────── conditional fits (PRD §16) ───────────────────────── */

const M_SPORT_QUESTION = {
  id: 'brake_config',
  questionKey: 'vin.clarify.brakeConfig',
  attribute: 'brake_config',
  options: [
    { value: 'STANDARD', labelKey: 'brake.standard' },
    { value: 'M_SPORT', labelKey: 'brake.mSport' },
  ],
};

const engineWithQuestions = new FitmentEngine({
  clarifications: { brake_config: M_SPORT_QUESTION },
});

test('an unanswered condition is CONDITIONAL and asks the question', () => {
  const r = engineWithQuestions.evaluate(
    bmw228i,
    product([fitment({ conditions: { brake_config: 'M_SPORT' } })]),
  );
  assert.equal(r.verdict, FitmentVerdict.CONDITIONAL);
  assert.equal(r.clarification?.id, 'brake_config');
});

test('a condition met by verified data is plain COMPATIBLE', () => {
  const vehicle = { ...bmw228i, verifiedData: { brake_config: 'M_SPORT' } };
  const r = engineWithQuestions.evaluate(
    vehicle,
    product([fitment({ conditions: { brake_config: 'M_SPORT' } })]),
  );
  assert.equal(r.verdict, FitmentVerdict.COMPATIBLE);
});

test("a condition met only by the owner's answer stays CONDITIONAL and is discounted", () => {
  const vehicle = { ...bmw228i, userSuppliedData: { brake_config: 'M_SPORT' } };
  const r = engineWithQuestions.evaluate(
    vehicle,
    product([fitment({ conditions: { brake_config: 'M_SPORT' } })]),
  );
  assert.equal(r.verdict, FitmentVerdict.CONDITIONAL);
  const verified = engineWithQuestions.evaluate(
    { ...bmw228i, verifiedData: { brake_config: 'M_SPORT' } },
    product([fitment({ conditions: { brake_config: 'M_SPORT' } })]),
  );
  assert.ok(r.confidence < verified.confidence, 'an owner claim must weigh less than a fact');
});

test('a condition contradicted by known data is not compatible', () => {
  const vehicle = { ...bmw228i, verifiedData: { brake_config: 'STANDARD' } };
  const r = engineWithQuestions.evaluate(
    vehicle,
    product([fitment({ conditions: { brake_config: 'M_SPORT' } })]),
  );
  assert.equal(r.verdict, FitmentVerdict.NOT_COMPATIBLE);
});

/* ───────────────────────── threshold ───────────────────────── */

test('below the confidence bar the verdict becomes UNCERTAIN', () => {
  const strict = new FitmentEngine({ minConfidence: 0.95 });
  const r = strict.evaluate(bmw228i, product([fitment({ source: FitmentSource.OEM_MATCH })]));
  assert.equal(r.verdict, FitmentVerdict.UNCERTAIN);
  assert.ok(r.reasons.some((x) => x.code === 'BELOW_CONFIDENCE_THRESHOLD'));
});

test('lowering the bar shows more, which is the trade the setting exists to make', () => {
  const lenient = new FitmentEngine({ minConfidence: 0.1 });
  const r = lenient.evaluate(bmw228i, product([fitment({ source: FitmentSource.OEM_MATCH })]));
  assert.equal(isSellable(r.verdict), true);
});

/* ───────────────────────── batch ───────────────────────── */

test('evaluateBatch decides each product independently', () => {
  const results = engine.evaluateBatch(bmw228i, [
    product([fitment()], { id: 'fits' }),
    product([fitment({ make: 'Toyota' })], { id: 'does-not' }),
  ]);
  assert.equal(results.get('fits')?.verdict, FitmentVerdict.COMPATIBLE);
  assert.equal(results.get('does-not')?.verdict, FitmentVerdict.NOT_COMPATIBLE);
});

test('every result carries the reasoning that produced it', () => {
  const r = engine.evaluate(bmw228i, product([fitment()]));
  assert.ok(r.reasons.length > 0);
  assert.ok(r.reasons.some((x) => x.code === 'WINNER'));
});

function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
