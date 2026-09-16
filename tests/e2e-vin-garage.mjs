/**
 * End-to-end checks for the auth + VIN + garage flow (build step 3).
 *
 * Runs against a live API with a migrated, seeded database:
 *   pnpm db:migrate && pnpm db:seed && pnpm --filter @autoparts/api start
 *   node tests/e2e-vin-garage.mjs
 *
 * The assertions that matter most are the ones about what must NOT happen:
 * a full VIN never leaves the API, one user never reads another user's
 * garage, and a reused refresh token kills every session.
 */
import { signIn, uniquePhone } from './lib/auth.mjs';

const API = process.env.API_URL ? process.env.API_URL + '/api/v1' : 'http://localhost:3001/api/v1';
let pass = 0, fail = 0;

const ok = (cond, label, extra = '') => {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label} ${extra}`); fail++; }
};

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, raw: text };
}

const phoneA = uniquePhone();
const phoneB = uniquePhone();

console.log('\n-- auth: phone + one-time code (ADR-015) --');
let r = await call('/auth/otp/request', { method: 'POST', body: { phone: '032 2 555 555' } });
ok(r.status === 400 && r.body?.error?.messageKey === 'error.auth.phoneInvalid',
   'a landline is refused before an SMS is spent on it', r.raw.slice(0, 160));

r = await call('/auth/otp/request', { method: 'POST', body: { phone: phoneA } });
ok(r.status === 200 && r.body?.challengeId, 'requesting a code returns a challenge', r.raw.slice(0, 200));
ok(!r.raw.includes(phoneA.slice(0, 7)), 'the response masks the number back', r.body?.maskedPhone);
const challengeA = r.body?.challengeId;
const codeA = r.body?.devCode;

r = await call('/auth/otp/request', { method: 'POST', body: { phone: phoneA } });
ok(r.status === 429 && r.body?.error?.messageKey === 'error.otp.resendTooSoon',
   'a second code for the same number is refused inside the cooldown', r.raw.slice(0, 160));

r = await call('/auth/otp/verify', { method: 'POST', body: { challengeId: challengeA, code: '000000' } });
ok(r.status === 401 && r.body?.error?.messageKey === 'error.otp.invalidCode', 'a wrong code is rejected');

r = await call('/auth/otp/verify', {
  method: 'POST',
  body: { challengeId: '00000000-0000-4000-8000-000000000000', code: codeA },
});
ok(r.status === 401, 'an unknown challenge gives the same 401, not a 404', `got ${r.status}`);

r = await call('/auth/otp/verify', { method: 'POST', body: { challengeId: challengeA, code: codeA } });
ok(r.status === 200 && r.body?.accessToken, 'the right code returns a token pair', r.raw.slice(0, 200));
ok(r.body?.isNewUser === true, 'an unknown number is registered by verifying its first code');
const tokenA = r.body?.accessToken;
const refreshA = r.body?.refreshToken;

r = await call('/auth/otp/verify', { method: 'POST', body: { challengeId: challengeA, code: codeA } });
ok(r.status === 401, 'the same code cannot be spent twice');

r = await call('/auth/me', { token: tokenA });
ok(r.status === 200 && r.body?.roles?.includes('CUSTOMER'), 'me returns the CUSTOMER role', r.raw.slice(0, 160));

r = await call('/auth/me');
ok(r.status === 401, 'me without a token is 401');

console.log('\n-- refresh rotation --');
r = await call('/auth/refresh', { method: 'POST', body: { refreshToken: refreshA } });
ok(r.status === 200 && r.body?.refreshToken !== refreshA, 'refresh rotates the token');
const refreshA2 = r.body?.refreshToken;

r = await call('/auth/refresh', { method: 'POST', body: { refreshToken: refreshA } });
ok(r.status === 401, 'a reused refresh token is refused');

r = await call('/auth/refresh', { method: 'POST', body: { refreshToken: refreshA2 } });
ok(r.status === 401, 'reuse revokes every session for that user');

console.log('\n-- VIN decode --');
r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV12345' } });
ok(r.status === 400 && r.body?.error?.messageKey === 'error.vin.length', 'a 16-character VIN is rejected', r.raw.slice(0, 160));

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV12345O' } });
ok(r.status === 400 && r.body?.error?.messageKey === 'error.vin.characters', 'a VIN containing O is rejected', r.raw.slice(0, 160));

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA9Z9Z99ZZ999999' } });
ok(r.status === 422 && r.body?.error?.details?.canEnterManually === true,
   'an unknown VIN offers manual entry rather than failing blankly', r.raw.slice(0, 200));

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV123456' } });
const decoded = r.body;
ok(r.status === 200 && decoded?.configuration?.make === 'BMW', 'the BMW decodes', r.raw.slice(0, 200));
ok(decoded?.vinMasked === 'WBA**********3456', 'the response masks the VIN', decoded?.vinMasked);
ok(!r.raw.includes('WBA1J5C50FV123456'), 'the full VIN never appears in the response body');
ok(decoded?.clarifications?.[0]?.id === 'brake_config', 'the ambiguous configuration asks a question');

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV123456' } });
ok(r.body?.fromCache === true, 'the decode is served from our own store, not a provider');
ok(r.body?.configurationId === decoded?.configurationId, 'the same VIN always resolves to the same configuration');
ok(r.body?.clarifications?.[0]?.id === 'brake_config', 'the clarification survives the cache');

console.log('\n-- garage --');
r = await call('/vehicles', { token: tokenA });
ok(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, 'a new garage is empty');

r = await call('/vehicles', {
  method: 'POST', token: tokenA,
  body: { configurationId: decoded.configurationId, customName: 'chemi BMW',
          clarificationAnswers: { brake_config: 'M_SPORT' } },
});
const vehicleId = r.body?.id;
ok(r.status === 201 && vehicleId, 'the vehicle is added', r.raw.slice(0, 250));
ok(r.body?.isDefault === true, 'the first vehicle becomes the default');
ok(r.body?.vinMasked === 'WBA**********3456', 'the garage shows a masked VIN');
ok(r.body?.userSuppliedData?.brake_config === 'M_SPORT', 'the clarification answer is stored separately');

r = await call('/vehicles', {
  method: 'POST', token: tokenA,
  body: { configurationId: decoded.configurationId },
});
ok(r.body?.id === vehicleId, 'adding the same VIN twice does not duplicate it');

r = await call('/vehicles', { token: tokenA });
ok(r.body?.length === 1, 'the garage holds one vehicle');
ok(r.body?.[0]?.label === 'chemi BMW', 'the custom name is used as the label');

console.log('\n-- isolation --');
const tokenB = (await signIn(call, phoneB)).token;

r = await call(`/vehicles/${vehicleId}`, { token: tokenB });
ok(r.status === 404, 'a vehicle belonging to someone else reads as absent, not forbidden', `got ${r.status}`);

r = await call('/vehicles', { token: tokenB });
ok(r.body?.length === 0, 'the other garage is unaffected');

r = await call(`/vehicles/${vehicleId}`, { method: 'DELETE', token: tokenB });
ok(r.status === 404, 'a cross-user delete is refused');

r = await call(`/vehicles/${vehicleId}`, { token: tokenA });
ok(r.status === 200, 'the owner still has the vehicle');

console.log('\n-- one VIN, two garages (PRD 11) --');
r = await call('/vehicles', {
  method: 'POST', token: tokenB,
  body: { configurationId: decoded.configurationId, customName: 'ojakhis BMW' },
});
ok(r.status === 201, 'the same VIN can sit in a second garage');
ok(r.body?.vinMasked === 'WBA**********3456', 'and is masked there too');

console.log('\n-- delete --');
r = await call(`/vehicles/${vehicleId}`, { method: 'DELETE', token: tokenA });
ok(r.status === 204, 'the owner can delete');
r = await call('/vehicles', { token: tokenA });
ok(r.body?.length === 0, 'the garage is empty again');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
