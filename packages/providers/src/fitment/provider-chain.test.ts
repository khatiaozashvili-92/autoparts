import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VinNotDecodableError, validateVin, maskVin, computeVinCheckDigit } from '@autoparts/core';
import { MockFitmentProvider, BRAKE_CONFIG_CLARIFICATION } from './mock.provider.js';
import { NhtsaVpicProvider } from './nhtsa-vpic.provider.js';
import { FitmentProviderChain } from './provider-chain.js';

/* ───────────────────────── VIN validation ───────────────────────── */

test('rejects VINs of the wrong length', () => {
  assert.equal(validateVin('WBA1J5C50FV12345').valid, false);
  assert.equal(validateVin('WBA1J5C50FV1234567').valid, false);
});

test('rejects I, O and Q, which never appear in a VIN', () => {
  for (const bad of ['I', 'O', 'Q']) {
    const vin = `WBA1J5C50FV12345${bad}`;
    assert.equal(validateVin(vin).reason, 'CHARACTERS', `expected ${bad} to be rejected`);
  }
});

test('verifies the check digit for North American VINs', () => {
  const base = '1FTEW1EP6JF99001';
  const withCorrectDigit = withCheckDigit(`${base}1`);
  const result = validateVin(withCorrectDigit);
  assert.equal(result.valid, true);
  assert.equal(result.checksumVerified, true);
});

test('a North American VIN with a wrong check digit is suspect, not malformed', () => {
  const vin = withCheckDigit('1FTEW1EP6JF990011');
  const tampered = `${vin.slice(0, 8)}${vin[8] === '0' ? '1' : '0'}${vin.slice(9)}`;
  const result = validateVin(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CHECKSUM');
  // Structurally it is still a VIN — a manufacturer's bad check digit must not
  // make a real car unservable, so free providers may still try.
  assert.equal(result.structurallyValid, true);
  assert.equal(result.checksumValid, false);
});

test('a European VIN is accepted without a verifiable checksum', () => {
  // The check digit is only mandated in North America; rejecting EU VINs on
  // it would lock out most European cars.
  const result = validateVin('WVWZZZ1KZAW334455');
  assert.equal(result.valid, true);
  assert.equal(result.checksumVerified, false);
});

test('masking never reveals the middle of a VIN', () => {
  const masked = maskVin('WBA1J5C50FV123456');
  assert.equal(masked, 'WBA**********3456');
  assert.ok(!masked.includes('J5C50'));
});

/* ───────────────────────── provider chain ───────────────────────── */

const bmw = {
  vin: 'WBA1J5C50FV123456',
  make: 'BMW',
  model: '2 Series',
  modelYear: 2016,
  engineCode: 'N20B20',
  market: 'US' as const,
  clarifications: [BRAKE_CONFIG_CLARIFICATION],
};

test('the primary provider answers and the fallback is not called', async () => {
  const primary = new MockFitmentProvider([bmw]);
  const fallback = new MockFitmentProvider([]);
  const chain = new FitmentProviderChain([primary, fallback]);

  const result = await chain.decodeVin(bmw.vin);

  assert.equal(result.configuration.make, 'BMW');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.outcome, 'ok');
});

test('vPIC is tried for a European-built VIN, because it may be a US-market car', async () => {
  // The first VIN character is the build country, not the market. A BMW built
  // in Germany and sold in the US has a W VIN and vPIC knows it — gating on VIN
  // region would skip exactly the cars Georgia imports most (ADR-003).
  let called = false;
  const vpic = new NhtsaVpicProvider(undefined, 5000, (async () => {
    called = true;
    return { ok: true, json: async () => ({ Results: [{ ErrorText: 'not found' }] }) };
  }) as unknown as typeof fetch);

  const chain = new FitmentProviderChain([vpic, new MockFitmentProvider([])]);

  await assert.rejects(() => chain.decodeVin('WVWZZZ1KZAW334455'), VinNotDecodableError);
  assert.equal(called, true, 'a free lookup is worth attempting');
});

test('a failing primary falls through to the fallback', async () => {
  const empty = new MockFitmentProvider([]);
  const populated = new MockFitmentProvider([bmw]);
  const chain = new FitmentProviderChain([empty, populated]);

  const result = await chain.decodeVin(bmw.vin);

  assert.equal(result.configuration.model, '2 Series');
  assert.equal(result.attempts[0]?.outcome, 'failed');
  assert.equal(result.attempts[1]?.outcome, 'ok');
});

test('clarification questions survive the chain', async () => {
  const chain = new FitmentProviderChain([new MockFitmentProvider([bmw])]);
  const result = await chain.decodeVin(bmw.vin);
  assert.equal(result.clarifications[0]?.id, 'brake_config');
});

test('the mock refuses an unknown VIN rather than inventing a car', async () => {
  const chain = new FitmentProviderChain([new MockFitmentProvider([bmw])]);
  await assert.rejects(() => chain.decodeVin('JF2SKAUC7LH445566'), VinNotDecodableError);
});

/* ───────────────────────── vPIC mapping ───────────────────────── */

test('vPIC rows map onto the shared configuration shape', async () => {
  const row = {
    Make: 'FORD',
    Model: 'F-150',
    ModelYear: '2018',
    Series: 'XLT',
    Trim: 'SuperCrew',
    DisplacementL: '2.7',
    EngineCylinders: '6',
    FuelTypePrimary: 'Gasoline',
    TransmissionStyle: 'Automatic',
    DriveType: '4WD/4-Wheel Drive/4x4',
    BodyClass: 'Pickup',
  };

  const provider = new NhtsaVpicProvider(undefined, 5000, (async () => ({
    ok: true,
    json: async () => ({ Results: [row] }),
  })) as unknown as typeof fetch);

  const result = await provider.decodeVin(withCheckDigit('1FTEW1EP6JF990011'));

  assert.equal(result.configuration.make, 'FORD');
  assert.equal(result.configuration.modelYear, 2018);
  assert.equal(result.configuration.fuelType, 'PETROL');
  assert.equal(result.configuration.transmission, 'AUTOMATIC');
  assert.equal(result.configuration.driveType, '4WD');
  assert.equal(result.configuration.bodyType, 'PICKUP');
  assert.equal(result.configuration.engine, '2.7L 6cyl');
  // vPIC has no manufacturer engine code; claiming one would be a fabrication.
  assert.equal(result.configuration.engineCode, null);
  assert.equal(result.configuration.market, 'US');
});

test('a vPIC row without make/model is an error, not an empty vehicle', async () => {
  const provider = new NhtsaVpicProvider(undefined, 5000, (async () => ({
    ok: true,
    json: async () => ({ Results: [{ ErrorText: '11 - Incorrect Model Year' }] }),
  })) as unknown as typeof fetch);

  await assert.rejects(
    () => provider.decodeVin(withCheckDigit('1FTEW1EP6JF990011')),
    VinNotDecodableError,
  );
});

/** Rewrites position 9 so a hand-written test VIN passes the checksum. */
function withCheckDigit(vin: string): string {
  const padded = vin.padEnd(17, '0').slice(0, 17);
  const digit = computeVinCheckDigit(padded);
  return `${padded.slice(0, 8)}${digit}${padded.slice(9)}`;
}


test('a suspect check digit skips paid providers but not free ones', async () => {
  const free = new MockFitmentProvider([bmw]);
  let paidCalled = false;
  const paid = {
    name: 'paid',
    capabilities: () => ({
      markets: ['US'], hasEngineCode: true, hasTrim: true,
      hasProductionDate: true, hasPartLinkage: true, costPerCallMinor: 25,
    }),
    supports: () => true,
    decodeVin: async () => {
      paidCalled = true;
      throw new Error('should not be reached');
    },
  };

  // A US-built VIN (leading digit) with position 9 deliberately broken: the
  // check digit is only mandated for North American VINs.
  const usVin = withCheckDigit('1FTEW1EP6JF990011');
  const tampered = usVin.slice(0, 8) + (usVin[8] === '0' ? '1' : '0') + usVin.slice(9);
  const known = { ...bmw, vin: tampered };
  const chain = new FitmentProviderChain([paid as never, new MockFitmentProvider([known])]);

  const result = await chain.decodeVin(tampered);

  assert.equal(paidCalled, false, 'a paid lookup must not be spent on a likely typo');
  assert.equal(result.checksumSuspect, true);
  assert.equal(result.configuration.make, 'BMW');
  assert.equal(result.attempts[0]?.outcome, 'skipped');
  void free;
});

test('a structurally invalid VIN never reaches any provider', async () => {
  let called = false;
  const provider = {
    name: 'any',
    capabilities: () => ({
      markets: ['US'], hasEngineCode: false, hasTrim: false,
      hasProductionDate: false, hasPartLinkage: false, costPerCallMinor: null,
    }),
    supports: () => true,
    decodeVin: async () => { called = true; throw new Error('unreachable'); },
  };
  const chain = new FitmentProviderChain([provider as never]);

  await assert.rejects(() => chain.decodeVin('TOO-SHORT'), VinNotDecodableError);
  assert.equal(called, false);
});
