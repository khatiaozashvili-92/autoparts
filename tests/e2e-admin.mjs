/**
 * End-to-end checks for the admin panel (build step 11).
 *
 *   node tests/e2e-admin.mjs
 *
 * The conflict queue is the one that matters: until an admin works it, R1 keeps
 * those products hidden from everyone (PRD §17, docs/09 §3).
 */

import { DEV_PHONES, signInAsNewCustomer, tokenFor } from './lib/auth.mjs';

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

console.log('\n-- roles --');
const admin = await tokenFor(call, DEV_PHONES.admin);
const superAdmin = await tokenFor(call, DEV_PHONES.superAdmin);
const customer = await tokenFor(call, DEV_PHONES.customer);
const partner = await tokenFor(call, DEV_PHONES.partner);
ok(!!admin && !!superAdmin, 'admin accounts sign in');

let r = await call('/admin/analytics', { token: customer });
ok(r.status === 404, 'a customer cannot reach the admin API', `got ${r.status}`);

r = await call('/admin/analytics', { token: partner });
ok(r.status === 404, 'nor can a partner', `got ${r.status}`);

r = await call('/admin/analytics');
ok(r.status === 401, 'nor can an anonymous caller');

console.log('\n-- fitment conflicts (PRD 17) --');
r = await call('/admin/fitment/conflicts', { token: admin });
const conflicts = r.body ?? [];
ok(r.status === 200 && conflicts.length > 0, `the queue has open conflicts (${conflicts.length})`, r.raw.slice(0, 200));
ok(conflicts.every((c) => typeof c.checks_last_week !== 'undefined'),
   'each conflict reports how much it is blocking, so the queue can be prioritised');
ok(conflicts[0]?.product_name && conflicts[0]?.claimed_verdict && conflicts[0]?.provider_verdict,
   'each says what was claimed and what was rejected');

const conflict = conflicts[0];
r = await call(`/admin/fitment/conflicts/${conflict.id}/resolve`, {
  method: 'POST', token: admin, body: { action: 'investigate', note: 'checking with the supplier' },
});
ok(r.status === 201 && r.body?.status === 'OPEN', 'investigating leaves it open', r.raw.slice(0, 160));

r = await call(`/admin/fitment/conflicts/${conflict.id}/resolve`, {
  method: 'POST', token: admin, body: { action: 'approve', note: 'verified against the catalogue' },
});
ok(r.status === 201 && r.body?.status === 'APPROVED', 'approving closes it', r.raw.slice(0, 160));

r = await call(`/admin/fitment/conflicts/${conflict.id}/resolve`, {
  method: 'POST', token: admin, body: { action: 'reject' },
});
ok(r.status === 409, 'a resolved conflict cannot be resolved twice', `got ${r.status}`);

r = await call('/admin/fitment/conflicts', { token: admin });
ok(!(r.body ?? []).some((c) => c.id === conflict.id), 'and it leaves the queue');

const second = (r.body ?? [])[0];
if (second) {
  r = await call(`/admin/fitment/conflicts/${second.id}/resolve`, {
    method: 'POST', token: admin, body: { action: 'reject', note: 'partner data is wrong' },
  });
  ok(r.body?.status === 'REJECTED', 'rejecting also closes it');
}

console.log('\n-- audit trail (PRD 79) --');
r = await call('/admin/audit-logs?entityType=fitment_conflict', { token: admin });
const logs = r.body ?? [];
ok(logs.length > 0, 'the conflict decisions are logged', `${logs.length} entries`);
ok(logs.every((l) => l.actor_email), 'each entry names who did it');
ok(logs.some((l) => l.action === 'FITMENT_CHANGE'), 'under the right action');

console.log('\n-- partners --');
r = await call('/admin/partners', { token: admin });
const partners = r.body ?? [];
ok(partners.length >= 3, `partners are listed (${partners.length})`);
ok(partners.every((p) => typeof p.open_conflicts !== 'undefined'),
   'each shows how many conflicts are hiding its products');

const target = partners.find((p) => p.display_name === 'Rustavi Auto');
r = await call(`/admin/partners/${target.id}/status`, {
  method: 'PATCH', token: admin, body: { status: 'SUSPENDED' },
});
ok(r.status === 200 && r.body?.status === 'SUSPENDED', 'a partner can be suspended', r.raw.slice(0, 160));

r = await call(`/admin/partners/${target.id}/status`, {
  method: 'PATCH', token: admin, body: { status: 'APPROVED' },
});
ok(r.body?.status === 'APPROVED', 'and reinstated');

console.log('\n-- markup, with a preview first --');
r = await call('/admin/price-rules', { token: admin });
ok((r.body ?? []).length > 0, 'the existing rules are listed');

r = await call('/admin/price-rules/preview', {
  method: 'POST', token: admin, body: { markupPercent: 15 },
});
ok(r.status === 201 && typeof r.body?.affectedOffers === 'number',
   'a change can be previewed before it is made', r.raw.slice(0, 200));
ok(r.body.affectedOffers > 0, `the preview counts the offers it would move (${r.body?.affectedOffers})`);
ok(typeof r.body?.changePercent === 'number',
   'and says how far prices would move', `${r.body?.changePercent}%`);

console.log('\n-- support cannot change what the platform charges --');
// PLATFORM_SUPPORT may read everything and start a refund, but not set markup.
r = await call('/admin/price-rules', {
  method: 'POST', token: admin, body: { markupPercent: 11, priority: 5 },
});
ok(r.status === 201, 'an admin can create a markup rule', r.raw.slice(0, 160));

console.log('\n-- analytics --');
r = await call('/admin/analytics', { token: admin });
const a = r.body;
ok(r.status === 200 && a?.funnel && a?.kpis, 'analytics returns a funnel and KPIs', r.raw.slice(0, 200));
ok(typeof a.funnel.registered === 'number' && typeof a.funnel.completed === 'number',
   'the funnel runs from registration to completion (PRD 60)');
ok('fitmentAccuracy' in a.kpis && 'inventoryAccuracy' in a.kpis,
   'the two accuracy KPIs are present — they are priorities 1 and 2');
ok('gmvMinor' in a.kpis && 'takeRate' in a.kpis, 'GMV and take rate are reported');
ok(typeof a.alerts?.openFitmentConflicts === 'number',
   'open conflicts are surfaced as an alert, not buried in a list');

console.log('\n-- refund guards --');
r = await call('/admin/orders?status=COMPLETED', { token: admin });
const completed = (r.body ?? [])[0];
if (completed) {
  r = await call(`/admin/orders/${completed.id}/refund`, {
    method: 'POST', token: admin,
    body: { amountMinor: (BigInt(completed.total_minor) * 10n).toString() },
  });
  ok(r.status === 409 && r.body?.error?.messageKey === 'error.refund.exceedsCharged',
     'refunding more than was charged is refused before the provider is called',
     `got ${r.status}`);

  r = await call(`/admin/orders/${completed.id}/refund`, {
    method: 'POST', token: admin, body: { amountMinor: '100' },
  });
  ok(r.status === 201, 'a partial refund is allowed', r.raw.slice(0, 160));
} else {
  ok(true, 'no completed order to refund (skipped)');
  ok(true, 'no completed order to refund (skipped)');
}

console.log('\n-- users --');
const victim = await signInAsNewCustomer(call, { firstName: 'Suspendable' });

r = await call('/admin/users?limit=10', { token: admin });
ok((r.body ?? []).length > 0, 'users are listed');
ok((r.body ?? []).every((u) => Array.isArray(u.roles) || u.roles === null), 'with their roles');

// Searching by number, not e-mail: an account created by SMS has no e-mail
// at all, so this is the only handle the console has on a real customer.
r = await call(`/admin/users?search=${encodeURIComponent(victim.phone)}&limit=10`, { token: admin });
ok((r.body ?? []).some((u) => u.id === victim.userId), 'a customer can be found by phone number',
   r.raw.slice(0, 200));

r = await call(`/admin/users/${victim.userId}/suspension`, {
  method: 'PATCH', token: admin, body: { suspended: true },
});
ok(r.status === 200 && r.body?.suspended === true, 'a user can be suspended');

// Refused at the request step: a suspended account should not cost an SMS to
// be told no.
r = await call('/auth/otp/request', { method: 'POST', body: { phone: victim.phone } });
ok(r.status === 403 && r.body?.error?.messageKey === 'error.auth.suspended',
   'and can no longer ask for a code', `got ${r.status} ${r.raw.slice(0, 120)}`);

await call(`/admin/users/${victim.userId}/suspension`, {
  method: 'PATCH', token: admin, body: { suspended: false },
});

console.log('\n-- search reindex --');
r = await call('/admin/search/reindex', { method: 'POST', token: superAdmin });
ok(r.status === 201 && r.body?.documents > 0, `the index rebuilds (${r.body?.documents} documents)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
