import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRows,
  parseAvailability,
  parsePriceToMinor,
} from './partner-integration.js';

const good = {
  sku: 'BP-2211',
  oem: '34 11 6 850 568',
  name: 'Front Brake Pads',
  brand: 'Bosch',
  price: '420.50',
  quantity: '5',
};

test('a well-formed row normalizes', () => {
  const { items, errors } = normalizeRows([good]);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.priceMinor, 42050n);
  assert.equal(items[0]?.identifiers[0]?.normalized, '34116850568');
  assert.equal(items[0]?.availability, 'IN_STOCK');
});

test('partner field names are mapped without any code change', () => {
  // Three partners, three vocabularies, one shape out (PRD §71).
  const a = normalizeRows([{ ...good, quantity: undefined as never, stock_qty: '5' }]);
  const b = normalizeRows([{ ...good, quantity: undefined as never, qty: '5' }]);
  const c = normalizeRows([{ ...good, quantity: undefined as never, count: '5' }]);
  for (const [name, result] of [['stock_qty', a], ['qty', b], ['count', c]] as const) {
    assert.equal(result.items[0]?.quantity, 5, `${name} should map to quantity`);
  }
});

test('header case and spacing do not matter', () => {
  const { items } = normalizeRows([
    { SKU: 'X-1', 'OEM Number': '34116850568', 'Product Name': 'Pads', Brand: 'TRW', Price: '10', Qty: '2' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.sku, 'X-1');
});

test('a bad row is rejected with its line number while the rest import', () => {
  // All-or-nothing would let one typo hold back a whole catalogue.
  const { items, errors } = normalizeRows([
    good,
    { ...good, sku: 'BP-2212', price: '-40' },
    { ...good, sku: 'BP-2213' },
  ]);
  assert.equal(items.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.row, 3, 'row numbers count the header and start at 1');
  assert.equal(errors[0]?.code, 'NEGATIVE_PRICE');
  assert.equal(errors[0]?.column, 'price');
});

test('a duplicate SKU in the same file points at the first occurrence', () => {
  const { items, errors } = normalizeRows([good, { ...good }]);
  assert.equal(items.length, 1);
  assert.equal(errors[0]?.code, 'DUPLICATE_IN_FILE');
  assert.match(errors[0]?.message ?? '', /row 2/);
});

test('a row with no identifier cannot be matched, so it is refused', () => {
  const { items, errors } = normalizeRows([{ ...good, oem: '' }]);
  assert.equal(items.length, 0);
  assert.equal(errors[0]?.code, 'NO_IDENTIFIER');
});

test('an unusable OEM is reported rather than silently stored', () => {
  const { errors } = normalizeRows([{ ...good, oem: '??' }]);
  assert.ok(errors.some((e) => e.code === 'INVALID_IDENTIFIER'));
});

test('every missing required column is named, not just the first', () => {
  const { errors } = normalizeRows([{ sku: 'X-1', oem: '34116850568' }]);
  const columns = errors.map((e) => e.column).sort();
  assert.deepEqual(columns, ['brand', 'name', 'price', 'quantity']);
});

test('negative quantity is refused', () => {
  const { errors } = normalizeRows([{ ...good, quantity: '-5' }]);
  assert.equal(errors[0]?.code, 'NEGATIVE_QUANTITY');
});

test('prices are parsed as integers, never as floats', () => {
  assert.equal(parsePriceToMinor('420.50'), 42050n);
  assert.equal(parsePriceToMinor('420,50'), 42050n);
  assert.equal(parsePriceToMinor('1 420.5'), 142050n);
  assert.equal(parsePriceToMinor('0.1'), 10n);
  assert.equal(parsePriceToMinor('abc'), null);
  // The classic float failure: 0.1 + 0.2 must be exactly 0.30 here.
  assert.equal(parsePriceToMinor('0.1')! + parsePriceToMinor('0.2')!, parsePriceToMinor('0.30'));
});

test('a stated availability beats the quantity', () => {
  // A partner writing "available to order" with 0 in stock means it; treating
  // that as UNAVAILABLE would drop stock they can actually supply (PRD §27).
  assert.equal(parseAvailability('available to order', 0), 'AVAILABLE_TO_ORDER');
  assert.equal(parseAvailability('discontinued', 12), 'UNAVAILABLE');
  assert.equal(parseAvailability(undefined, 3), 'IN_STOCK');
  assert.equal(parseAvailability(undefined, 0), 'UNAVAILABLE');
  assert.equal(parseAvailability('in stock', 0), 'AVAILABLE_TO_ORDER');
});
