/**
 * End-to-end checks for search (build step 7).
 *
 *   node tests/e2e-search.mjs
 *
 * PRD §13–14: Georgian and English, synonyms, typos, OEM numbers — and
 * always for one specific vehicle, never "parts in general".
 */

const API = process.env.API_URL ? process.env.API_URL + '/api/v1' : 'http://localhost:3001/api/v1';
const DEV_PASSWORD = 'dev-password-change-me';
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
let r = await call('/auth/login', {
  method: 'POST',
  body: { identifier: 'customer@autoparts.dev', password: DEV_PASSWORD },
});
const token = r.body?.accessToken;
ok(!!token, 'signed in as the seeded customer');

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV123456' } });
r = await call('/vehicles', { method: 'POST', token, body: { configurationId: r.body.configurationId } });
const bmwId = r.body?.id;
ok(!!bmwId, 'the BMW is in the garage');

console.log('\n-- a vehicle is mandatory --');
r = await call(`/search?q=${encodeURIComponent('ხუნდები')}`);
ok(r.status === 400, 'searching without a vehicle is rejected', `got ${r.status}`);

console.log('\n-- Georgian --');
r = await call(`/search?q=${encodeURIComponent('სამუხრუჭე ხუნდები')}&vehicleId=${bmwId}`);
ok(r.status === 200 && r.body?.data?.length > 0, 'a Georgian part name finds products', r.raw.slice(0, 200));
ok(r.body?.interpreted?.matchedBy === 'EXACT_TEXT', 'matched as text', r.body?.interpreted?.matchedBy);
const brakeHits = r.body.data;

console.log('\n-- English --');
r = await call(`/search?q=brake%20pads&vehicleId=${bmwId}`, { locale: 'en' });
ok(r.body?.data?.length > 0, 'the English name finds products too');

console.log('\n-- synonyms (PRD §13) --');
r = await call(`/search?q=${encodeURIComponent('კალოდკები')}&vehicleId=${bmwId}`);
ok(r.body?.data?.length > 0, 'a colloquial synonym works', r.body?.interpreted?.matchedBy);

r = await call(`/search?q=${encodeURIComponent('აკუმულატორი')}&vehicleId=${bmwId}`);
ok(r.body?.interpreted?.matchedBy !== 'NONE', 'battery by its Georgian name');

console.log('\n-- typo tolerance --');
// PRD §13 names "აკუმლატორი" as the worked example. It is carried as a known
// synonym rather than left to fuzzy matching, which is the stronger outcome:
// the correction is exact instead of probabilistic.
r = await call(`/search?q=${encodeURIComponent('აკუმლატორი')}&vehicleId=${bmwId}`);
ok(r.body?.interpreted?.matchedBy === 'EXACT_TEXT',
   'a known misspelling is handled as a synonym, matched exactly',
   r.body?.interpreted?.matchedBy);

// An unanticipated typo has to fall through to trigram similarity.
r = await call(`/search?q=${encodeURIComponent('რადიატრი')}&vehicleId=${bmwId}`);
ok(r.body?.interpreted?.matchedBy === 'FUZZY_TEXT',
   'an unlisted misspelling is caught by similarity', r.body?.interpreted?.matchedBy);
ok(typeof r.body?.interpreted?.didYouMean === 'string',
   'and the correction is shown rather than applied silently',
   r.body?.interpreted?.didYouMean);

r = await call(`/search?q=brek%20pads&vehicleId=${bmwId}`, { locale: 'en' });
ok(r.body?.interpreted?.matchedBy !== 'NONE',
   'an English typo is tolerated too', r.body?.interpreted?.matchedBy);

console.log('\n-- OEM lookup --');
const oem = brakeHits.find((h) => h.oem)?.oem;
ok(!!oem, 'a hit carries an OEM number');
r = await call(`/search?q=${encodeURIComponent(oem)}&vehicleId=${bmwId}`);
ok(r.body?.interpreted?.matchedBy === 'IDENTIFIER',
   'pasting an OEM number is recognised as an identifier', r.body?.interpreted?.matchedBy);

console.log('\n-- R1 holds in search --');
r = await call(`/search?q=${encodeURIComponent('სამუხრუჭე ხუნდები')}&vehicleId=${bmwId}`);
ok(r.body.data.every((h) => SELLABLE.includes(h.fitment.verdict)),
   'every result is a confirmed fit',
   r.body.data.map((h) => h.fitment.verdict).join(','));
ok(r.body.data.every((h) => h.offerSummary.count > 0),
   'every result actually has an offer behind it');
ok(r.body.data.every((h) => h.fitment.labelKey.startsWith('fitment.')),
   'verdicts travel as i18n keys, not rendered copy');

console.log('\n-- different cars, different answers --');
r = await call('/vin/decode', { method: 'POST', body: { vin: 'W0L0AHL0885667788' } });
r = await call('/vehicles', { method: 'POST', token, body: { configurationId: r.body.configurationId } });
const opelId = r.body?.id;

const bmwSearch = await call(`/search?q=${encodeURIComponent('ზეთის ფილტრი')}&vehicleId=${bmwId}`);
const opelSearch = await call(`/search?q=${encodeURIComponent('ზეთის ფილტრი')}&vehicleId=${opelId}`);
const bmwIds = new Set((bmwSearch.body?.data ?? []).map((h) => h.productId));
const opelIds = new Set((opelSearch.body?.data ?? []).map((h) => h.productId));
ok(bmwIds.size > 0 || opelIds.size > 0, 'at least one car has oil filters');
ok(JSON.stringify([...bmwIds].sort()) !== JSON.stringify([...opelIds].sort()),
   'the two cars do not get identical results',
   `BMW ${bmwIds.size}, Opel ${opelIds.size}`);

console.log('\n-- nothing found --');
r = await call(`/search?q=${encodeURIComponent('ზზზზზზ')}&vehicleId=${bmwId}`);
ok(r.body?.data?.length === 0, 'gibberish returns nothing');
ok(r.body?.emptyReason === 'NO_QUERY_MATCH',
   'and says why, so the UI can offer the next step (PRD §37)', r.body?.emptyReason);

console.log('\n-- availability filter --');
r = await call(`/search?q=${encodeURIComponent('სამუხრუჭე ხუნდები')}&vehicleId=${bmwId}&availability=IN_STOCK`);
ok(r.status === 200, 'the in-stock filter is accepted');
ok((r.body?.data ?? []).every((h) => h.offerSummary.bestAvailability === 'IN_STOCK'),
   'and only returns in-stock results');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
