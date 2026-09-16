/**
 * End-to-end checks for the purchase flow (build steps 8–10).
 *
 *   node tests/e2e-purchase.mjs
 *
 * Covers offers and sorting (PRD §31–35), the cart's fitment gate, the
 * 15-minute reservation (§28), checkout and capture (§29), pickup with a code
 * (§49) and cancellation with an automatic refund (§51).
 */

import { DEV_PHONES, signInAsNewCustomer, tokenFor } from './lib/auth.mjs';

const API = process.env.API_URL ? process.env.API_URL + '/api/v1' : 'http://localhost:3001/api/v1';
let pass = 0, fail = 0;

const ok = (cond, label, extra = '') => {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label} ${extra}`); fail++; }
};

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, raw: text };
}

const login = (phone) => tokenFor(call, phone);

console.log('\n-- setup --');
// A number nobody has used, so this run gets a clean garage, cart and order
// history rather than inheriting the last run's.
const buyer = await signInAsNewCustomer(call, { firstName: 'Buyer' });
const customer = buyer.token;
ok(!!customer, 'a customer account exists');

// Idempotency keys have to be unique per run, or the second run of this suite
// replays the first one's checkout instead of performing its own.
const stamp = Date.now();

let r;

r = await call('/vin/decode', { method: 'POST', body: { vin: 'WBA1J5C50FV123456' } });
r = await call('/vehicles', { method: 'POST', token: customer, body: { configurationId: r.body.configurationId } });
const vehicleId = r.body?.id;
ok(!!vehicleId, 'the BMW is in the garage');

r = await call(`/search?q=${encodeURIComponent('სამუხრუჭე ხუნდები')}&vehicleId=${vehicleId}&availability=IN_STOCK`);
const hit = (r.body?.data ?? [])[0];
ok(!!hit, 'search found an in-stock compatible product', r.raw.slice(0, 200));

console.log('\n-- offers (PRD 31-35) --');
r = await call(`/offers?productId=${hit.productId}&vehicleId=${vehicleId}`);
const offers = r.body?.data ?? [];
ok(offers.length > 0, `offers are listed (${offers.length})`, r.raw.slice(0, 200));
ok(offers.every((o) => o.price?.amountMinor && o.price?.currency), 'each offer carries a price');
ok(offers.every((o) => o.platformMarkupMinor === undefined && o.basePriceMinor === undefined),
   'a customer never sees the base price or the markup, only what they pay');
ok(offers.every((o) => typeof o.stock?.ageMinutes === 'number'),
   'stock freshness is on every offer (R2)');
ok(offers.every((o) => o.partner?.displayName), 'the seller is named');

r = await call(`/offers?productId=${hit.productId}&vehicleId=${vehicleId}&sort=cheapest`);
const cheapest = r.body?.data ?? [];
const prices = cheapest.map((o) => Number(o.price.amountMinor));
ok(prices.every((p, i) => i === 0 || prices[i - 1] <= p), 'cheapest sorts ascending', prices.join(','));

r = await call(`/offers?productId=${hit.productId}&vehicleId=${vehicleId}&sort=recommended`);
ok((r.body?.data ?? []).every((o) => typeof o.recommendedScore === 'number'),
   'recommended attaches a score');

console.log('\n-- offers for a car it does not fit --');
r = await call('/vin/decode', { method: 'POST', body: { vin: 'W0L0AHL0885667788' } });
r = await call('/vehicles', { method: 'POST', token: customer, body: { configurationId: r.body.configurationId } });
const opelId = r.body?.id;
r = await call(`/offers?productId=${hit.productId}&vehicleId=${opelId}`);
ok(r.body?.data?.length === 0 ? r.body?.emptyReason === 'NOT_COMPATIBLE' : true,
   'an incompatible product says so rather than returning a bare empty list',
   r.body?.emptyReason ?? 'had offers');

console.log('\n-- cart --');
const inStock = offers.find((o) => o.availability === 'IN_STOCK');
ok(!!inStock, 'there is an in-stock offer to buy');

r = await call('/cart/items', {
  method: 'POST', token: customer,
  body: { offerId: inStock.offerId, vehicleId, quantity: 1 },
});
ok(r.status === 201 && r.body?.items?.length === 1, 'the item is in the cart', r.raw.slice(0, 200));
ok(r.body?.partnerIds?.length === 1, 'one partner so far');

r = await call('/cart/items', {
  method: 'POST', token: customer,
  body: { offerId: inStock.offerId, vehicleId: opelId, quantity: 1 },
});
ok(r.status === 422 && r.body?.error?.code === 'FITMENT_NOT_CONFIRMED',
   'the cart refuses a part that does not fit the chosen car (R1)', `got ${r.status}`);

console.log('\n-- reservation (PRD 28) --');
r = await call('/checkout/reserve', { method: 'POST', token: customer });
const quote = r.body;
ok(r.status === 201 && quote?.reservationIds?.length === 1, 'stock is reserved', r.raw.slice(0, 250));
ok(!!quote?.expiresAt, 'the hold has an expiry the UI can show');
const ttlMinutes = (new Date(quote.expiresAt) - Date.now()) / 60000;
ok(ttlMinutes > 13 && ttlMinutes <= 15.5, `the hold lasts about 15 minutes (${ttlMinutes.toFixed(1)})`);
ok(BigInt(quote.totals.totalMinor) === BigInt(quote.totals.subtotalMinor) + BigInt(quote.totals.markupMinor),
   'the totals add up: subtotal + markup = total');
ok(!!quote.pickupLocation?.address, 'the pickup address is quoted up front (PRD 42)');

r = await call(`/offers?productId=${hit.productId}&vehicleId=${vehicleId}`);
const afterHold = (r.body?.data ?? []).find((o) => o.offerId === inStock.offerId);
ok((afterHold?.availableQuantity ?? 0) === inStock.availableQuantity - 1,
   'marketplace availability drops by the reserved quantity',
   `${inStock.availableQuantity} -> ${afterHold?.availableQuantity}`);

console.log('\n-- checkout --');
const idemKey = `test-${stamp}`;
r = await call('/checkout/confirm', {
  method: 'POST', token: customer,
  headers: { 'idempotency-key': idemKey },
  body: { reservationIds: quote.reservationIds },
});
const order = r.body;
ok(r.status === 201 && order?.orderNumber, 'the order is created', r.raw.slice(0, 250));

r = await call('/checkout/confirm', {
  method: 'POST', token: customer,
  headers: { 'idempotency-key': idemKey },
  body: { reservationIds: quote.reservationIds },
});
ok(r.body?.orderNumber === order.orderNumber,
   'replaying the same idempotency key returns the same order, not a second one',
   r.body?.orderNumber);

r = await call(`/orders/${order.orderId}/capture`, { method: 'POST', token: customer });
ok(r.status === 200 && r.body?.status === 'CONFIRMED', 'the payment captures', r.raw.slice(0, 200));

r = await call(`/orders/${order.orderId}`, { token: customer });
ok(r.body?.status === 'CONFIRMED' && r.body?.payment_status === 'CAPTURED', 'the order is confirmed and paid');
ok(r.body?.items?.[0]?.fitment_verdict, 'the fitment verdict is frozen onto the order line as evidence');
ok(!!r.body?.items?.[0]?.product_snapshot?.name,
   'the product is snapshotted, so a later rename cannot rewrite history');

r = await call('/cart', { token: customer });
ok(r.body?.items?.length === 0, 'the cart is emptied after a successful purchase');

console.log('\n-- pickup (PRD 48-50) --');
const partner = await login(DEV_PHONES.partner);

r = await call(`/orders/${order.orderId}/pickup-code`, { token: customer });
ok(r.status === 409, 'no code before the partner marks it ready', `got ${r.status}`);

r = await call('/partner/orders', { token: partner });
const queued = (r.body ?? []).find((o) => o.order_number === order.orderNumber);
ok(!!queued, 'the order appears in the partner queue');
ok(!!queued?.vehicle, 'the partner sees the car, so they pull the right part');
ok(!JSON.stringify(queued ?? {}).match(/WBA1J5C50FV123456/),
   'but never the VIN — they do not need it (docs/07 7)');

r = await call(`/partner/orders/${order.orderId}/ready`, { method: 'POST', token: partner });
ok(r.status === 201 && r.body?.status === 'READY_FOR_PICKUP', 'the partner marks it ready', r.raw.slice(0, 200));
const deadlineHours = (new Date(r.body.deadline) - Date.now()) / 3600000;
ok(deadlineHours > 23 && deadlineHours <= 24.5,
   `a 24-hour pickup deadline starts (${deadlineHours.toFixed(1)}h)`);

r = await call(`/orders/${order.orderId}/pickup-code`, { token: customer });
const code = r.body?.code;
ok(/^\d{6}$/.test(code ?? ''), 'the customer gets a six-digit code', code);
ok(!!r.body?.location?.address, 'along with where to collect it');

r = await call(`/partner/orders/${order.orderId}/verify-pickup`, {
  method: 'POST', token: partner, body: { code: '000000' },
});
ok(r.status === 400, 'a wrong code is refused', `got ${r.status}`);

r = await call(`/partner/orders/${order.orderId}/verify-pickup`, {
  method: 'POST', token: partner, body: { code },
});
ok(r.status === 201 && r.body?.status === 'PICKED_UP', 'the right code hands the part over', r.raw.slice(0, 160));

r = await call(`/orders/${order.orderId}`, { token: customer });
ok(r.body?.status === 'PICKED_UP',
   'handover alone does not complete the order — that is the customer’s to give (PRD 50)');

r = await call(`/orders/${order.orderId}/confirm-receipt`, { method: 'POST', token: customer });
ok(r.status === 200 && r.body?.status === 'COMPLETED', 'the customer completes it');

console.log('\n-- cancellation and refund (PRD 51) --');
r = await call(`/orders/${order.orderId}/cancel`, { method: 'POST', token: customer });
ok(r.status === 409, 'a completed order can no longer be cancelled', `got ${r.status}`);

// A second order, cancelled before it is ready.
r = await call('/cart/items', {
  method: 'POST', token: customer,
  body: { offerId: inStock.offerId, vehicleId, quantity: 1 },
});
r = await call('/checkout/reserve', { method: 'POST', token: customer });
const quote2 = r.body;
r = await call('/checkout/confirm', {
  method: 'POST', token: customer,
  headers: { 'idempotency-key': `test-${stamp}-2` },
  body: { reservationIds: quote2.reservationIds },
});
const order2 = r.body;
await call(`/orders/${order2.orderId}/capture`, { method: 'POST', token: customer });

r = await call(`/orders/${order2.orderId}/cancel`, { method: 'POST', token: customer });
ok(r.status === 200 && r.body?.status === 'CANCELLED', 'cancellation before ready is allowed', r.raw.slice(0, 160));

r = await call(`/orders/${order2.orderId}`, { token: customer });
ok(r.body?.payment_status === 'REFUNDED', 'and the money is refunded automatically');

console.log('\n-- isolation --');
const otherPartner = await login(DEV_PHONES.partner2);
r = await call(`/partner/orders/${order2.orderId}/ready`, { method: 'POST', token: otherPartner });
ok(r.status === 404, "another partner cannot touch this order", `got ${r.status}`);

r = await call(`/orders/${order.orderId}`, { token: await login(DEV_PHONES.customer) });
ok(r.status === 404, "another customer cannot read this order", `got ${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
