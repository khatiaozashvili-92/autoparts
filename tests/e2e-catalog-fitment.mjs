/**
 * End-to-end checks for the catalogue and the fitment engine (build steps 4–5).
 *
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm --filter @autoparts/api start
 *   node tests/e2e-catalog-fitment.mjs
 *
 * The point of these assertions is R1 (PRD §97): a product is shown as
 * compatible only when compatibility is confirmed, and "I don't know" must
 * never reach the client as "maybe".
 */

const API = process.env.API_URL ? process.env.API_URL + '/api/v1' : 'http://localhost:3001/api/v1';
let pass = 0, fail = 0;

const ok = (cond, label, extra = '') => {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label} ${extra}`); fail++; }
};

async function call(path, { method = 'GET', body, token, locale = 'ka' } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': locale,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, raw: text };
}

const SELLABLE = ['EXACT', 'COMPATIBLE', 'CONDITIONAL'];

console.log('\n-- setup --');
const stamp = Date.now();
let r = await call('/auth/register', {
  method: 'POST',
  body: { email: `cat${stamp}@example.com`, password: 'correct-horse-battery' },
});
const token = r.body?.accessToken;
ok(!!token, 'registered a user', r.raw.slice(0, 160));

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV123456' } });
const bmwConfig = r.body?.configurationId;
ok(!!bmwConfig, 'decoded the BMW');

r = await call('/vehicles', { method: 'POST', token, body: { configurationId: bmwConfig } });
const bmwId = r.body?.id;
ok(!!bmwId, 'added the BMW to the garage', r.raw.slice(0, 200));

// A second, very different car, to prove the filter actually discriminates.
r = await call('/vin/decode', { method: 'POST', body: { vin: 'W0L0AHL0885667788' } });
const opelConfig = r.body?.configurationId;
r = await call('/vehicles', { method: 'POST', token, body: { configurationId: opelConfig } });
const opelId = r.body?.id;
ok(!!opelId, 'added an EU-market Opel to the garage');

console.log('\n-- categories --');
r = await call('/categories', { locale: 'ka' });
ok(r.status === 200 && r.body?.length === 18, 'all 18 categories are returned', `got ${r.body?.length}`);
ok(r.body?.find((c) => c.slug === 'brakes')?.name === 'სამუხრუჭე სისტემა', 'Georgian names are used');

r = await call('/categories', { locale: 'en' });
ok(r.body?.find((c) => c.slug === 'brakes')?.name === 'Brakes', 'English names are used');

r = await call('/categories', { locale: 'de' });
ok(r.body?.find((c) => c.slug === 'brakes')?.name === 'სამუხრუჭე სისტემა',
   'an unknown locale falls back rather than returning blanks');

console.log('\n-- parts, scored against a vehicle --');
r = await call('/categories/brakes/parts');
const partsNoVehicle = r.body ?? [];
ok(partsNoVehicle.length > 0, 'brake parts are listed without a vehicle');
ok(partsNoVehicle.every((p) => p.availableProducts === undefined),
   'no availability is claimed when no vehicle was given');

r = await call(`/categories/brakes/parts?vehicleId=${bmwId}`);
const partsForBmw = r.body ?? [];
ok(partsForBmw.every((p) => typeof p.availableProducts === 'number'),
   'with a vehicle, each part reports how many products fit');

const bmwTotal = partsForBmw.reduce((n, p) => n + p.availableProducts, 0);
ok(bmwTotal > 0, `the BMW has fitting brake products (${bmwTotal})`);

r = await call(`/categories/brakes/parts?vehicleId=${opelId}`);
const opelTotal = (r.body ?? []).reduce((n, p) => n + p.availableProducts, 0);
ok(bmwTotal !== opelTotal,
   `two different cars get different results (BMW ${bmwTotal} vs Opel ${opelTotal})`);

console.log('\n-- R1: only confirmed fits reach the client --');
const partWithProducts = partsForBmw.find((p) => p.availableProducts > 0);
ok(!!partWithProducts, 'found a part with fitting products');

r = await call(`/master-parts/${partWithProducts.id}/products?vehicleId=${bmwId}`, { token });
const products = r.body ?? [];
ok(r.status === 200 && products.length > 0, 'products are returned', r.raw.slice(0, 200));
ok(products.every((p) => SELLABLE.includes(p.fitment?.verdict)),
   'every returned product carries a sellable verdict',
   products.map((p) => p.fitment?.verdict).join(','));
ok(!products.some((p) => p.fitment?.verdict === 'UNCERTAIN'),
   'UNCERTAIN never appears in results');
ok(!products.some((p) => p.fitment?.verdict === 'NOT_COMPATIBLE'),
   'NOT_COMPATIBLE never appears in results');
ok(products.every((p) => typeof p.fitment?.labelKey === 'string'),
   'each verdict carries an i18n label key rather than rendered copy');
ok(products.length === partWithProducts.availableProducts,
   'the count on the category page matches the list',
   `${products.length} vs ${partWithProducts.availableProducts}`);

console.log('\n-- searching without a vehicle is refused --');
r = await call(`/master-parts/${partWithProducts.id}/products`, { token });
ok(r.status === 400 && r.body?.error?.code === 'VEHICLE_REQUIRED',
   'listing products for a part requires a vehicle', `got ${r.status}`);

console.log('\n-- product detail --');
const productId = products[0].id;
r = await call(`/products/${productId}`);
ok(r.status === 200 && !r.body?.fitment,
   'without a vehicle a product has no fitment verdict at all');
ok(Array.isArray(r.body?.identifiers) && r.body.identifiers.some((i) => i.kind === 'OEM'),
   'the product exposes its OEM number (PRD §54)');
ok(!!r.body?.brand?.name && !!r.body?.masterPart?.name, 'brand and master part are present');

r = await call(`/products/${productId}?vehicleId=${bmwId}`);
ok(SELLABLE.includes(r.body?.fitment?.verdict),
   'with a vehicle the verdict is attached', r.body?.fitment?.verdict);

console.log('\n-- fitment accuracy telemetry --');
r = await call('/meta/catalog');
const checksBefore = r.body?.counts?.fitment_checks ?? 0;
await call(`/master-parts/${partWithProducts.id}/products?vehicleId=${bmwId}`, { token });
r = await call('/meta/catalog');
const checksAfter = r.body?.counts?.fitment_checks ?? 0;
ok(checksAfter > checksBefore,
   'every evaluation is logged, which is what makes the KPI measurable',
   `${checksBefore} -> ${checksAfter}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
