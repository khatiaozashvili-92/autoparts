/**
 * End-to-end checks for the partner portal (build step 6).
 *
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm --filter @autoparts/api start
 *   node tests/e2e-partner.mjs
 *
 * The decisive assertions are the isolation ones: a partner must never see
 * another partner's prices (PRD §3, §31), and that is enforced at the query,
 * not in the UI.
 */

import { DEV_PHONES, tokenFor } from './lib/auth.mjs';

const API = process.env.API_URL ? process.env.API_URL + '/api/v1' : 'http://localhost:3001/api/v1';
let pass = 0, fail = 0;

const ok = (cond, label, extra = '') => {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label} ${extra}`); fail++; }
};

async function call(path, { method = 'GET', body, token, raw, contentType } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (raw !== undefined) {
    payload = raw;
    if (contentType) headers['content-type'] = contentType;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, raw: text };
}

console.log('\n-- sign in --');
const partnerA = await tokenFor(call, DEV_PHONES.partner);
const partnerB = await tokenFor(call, DEV_PHONES.partner2);
const customer = await tokenFor(call, DEV_PHONES.customer);
ok(!!partnerA && !!partnerB && !!customer, 'seeded accounts can sign in');

console.log('\n-- profile and scope --');
let r = await call('/partner/profile', { token: partnerA });
ok(r.status === 200 && r.body?.displayName === 'Auto Motors', 'partner A sees its own profile', r.raw.slice(0, 160));
const partnerAId = r.body?.id;

r = await call('/partner/profile', { token: partnerB });
ok(r.body?.displayName === 'Parts Center', 'partner B sees a different profile');
ok(r.body?.id !== partnerAId, 'the two are genuinely different partners');

r = await call('/partner/profile', { token: customer });
ok(r.status === 404, 'a customer is not a partner and gets 404, not 403', `got ${r.status}`);

r = await call('/partner/profile');
ok(r.status === 401, 'an anonymous request is unauthenticated');

console.log('\n-- offers are partner-scoped --');
r = await call('/partner/offers?limit=200', { token: partnerA });
const offersA = r.body ?? [];
r = await call('/partner/offers?limit=200', { token: partnerB });
const offersB = r.body ?? [];
ok(offersA.length > 0 && offersB.length > 0, `both partners have offers (${offersA.length} / ${offersB.length})`);

const idsA = new Set(offersA.map((o) => o.id));
const overlap = offersB.filter((o) => idsA.has(o.id));
ok(overlap.length === 0, 'no offer appears in both listings', `${overlap.length} overlapping`);

ok(offersA.every((o) => o.basePriceMinor && o.customerPriceMinor),
   'a partner sees its own base price and the shelf price');
ok(offersA.every((o) => o.platformMarkupMinor === undefined),
   'but never the platform markup, which is a commercial term');
ok(offersA.every((o) => typeof o.stockAgeMinutes === 'number'),
   'stock freshness is always reported');

console.log('\n-- cross-partner writes are refused --');
const offerOfB = offersB[0];
r = await call(`/partner/offers/${offerOfB.id}`, {
  method: 'PATCH', token: partnerA, body: { stockQuantity: 999 },
});
ok(r.status === 404, "partner A cannot touch partner B's offer", `got ${r.status}`);

r = await call('/partner/offers?limit=200', { token: partnerB });
const unchanged = (r.body ?? []).find((o) => o.id === offerOfB.id);
ok(unchanged?.stockQuantity === offerOfB.stockQuantity, "and the offer really is unchanged");

console.log('\n-- editing your own offer --');
const mine = offersA[0];
r = await call(`/partner/offers/${mine.id}`, {
  method: 'PATCH', token: partnerA, body: { basePriceMinor: '50000', stockQuantity: 7 },
});
ok(r.status === 200, 'partner A can edit its own offer', r.raw.slice(0, 160));

r = await call('/partner/offers?limit=200', { token: partnerA });
const edited = (r.body ?? []).find((o) => o.id === mine.id);
ok(edited?.stockQuantity === 7, 'the stock change stuck');
ok(edited?.basePriceMinor === '50000', 'the base price change stuck');
ok(BigInt(edited?.customerPriceMinor ?? '0') > 50000n,
   'the customer price was recomputed with markup, not left stale',
   `customer=${edited?.customerPriceMinor}`);

console.log('\n-- CSV import --');
r = await call('/partner/inventory/template.csv');
ok(r.status === 200 && r.raw.startsWith('sku,oem'), 'the template is downloadable');

// One good row, one with a negative price, one duplicate, one unmatchable.
const oem = offersA.find((o) => o.oem)?.oem ?? '34116850568';
const csv = [
  'sku,oem,name,brand,price,quantity,availability',
  `IMP-1,${oem},Imported Pads,Bosch,123.45,9,in_stock`,
  `IMP-2,${oem},Duplicate OEM different sku,Bosch,50.00,1,in_stock`,
  'IMP-3,99999999999,Unknown part,Bosch,10.00,1,in_stock',
  'IMP-4,34116850568,Negative,Bosch,-5,1,in_stock',
  'IMP-1,34116850568,Duplicate sku,Bosch,10,1,in_stock',
].join('\n');

const form = new FormData();
form.append('file', new Blob([csv], { type: 'text/csv' }), 'inventory.csv');
let res = await fetch(`${API}/partner/inventory/csv`, {
  method: 'POST',
  headers: { authorization: `Bearer ${partnerA}` },
  body: form,
});
const summary = await res.json();
ok(res.status === 201 || res.status === 200, 'the upload is accepted', JSON.stringify(summary).slice(0, 200));
ok(summary.status === 'PARTIAL', 'a file with some bad rows imports partially', summary.status);
ok(summary.rowsOk >= 1, `good rows import (${summary.rowsOk})`);
ok(summary.errors?.some((e) => e.code === 'NEGATIVE_PRICE'), 'the negative price is reported');
ok(summary.errors?.some((e) => e.code === 'DUPLICATE_IN_FILE'), 'the duplicate SKU is reported');
ok(summary.errors?.some((e) => e.code === 'PRODUCT_NOT_FOUND'), 'the unmatchable row is reported');
ok(summary.errors?.every((e) => typeof e.row === 'number'),
   'every error names the row it came from');

console.log('\n-- sync history --');
r = await call('/partner/inventory/syncs', { token: partnerA });
ok(Array.isArray(r.body) && r.body.length > 0, 'the sync is recorded');
const syncId = r.body[0]?.id;

r = await call(`/partner/inventory/syncs/${syncId}`, { token: partnerA });
ok(r.status === 200 && Array.isArray(r.body?.errors), 'the sync detail carries row-level errors');

r = await call(`/partner/inventory/syncs/${syncId}`, { token: partnerB });
ok(r.status === 404, "partner B cannot read partner A's sync", `got ${r.status}`);

console.log('\n-- onboarding and dashboard --');
r = await call('/partner/onboarding', { token: partnerA });
ok(Array.isArray(r.body?.steps) && r.body.steps.length === 4, 'onboarding lists its four gates');
ok(r.body.steps.every((s) => typeof s.done === 'boolean'), 'each gate says whether it is done');

r = await call('/partner/dashboard', { token: partnerA });
ok(typeof r.body?.totalOffers === 'number', 'the dashboard counts offers');
ok('minutesSinceSync' in (r.body ?? {}), 'and always reports stock freshness');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
