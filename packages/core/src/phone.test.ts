import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatPhone, isMobileNumber, maskPhone, normalizePhone } from './phone.js';

/**
 * The phone number is the account (ADR-015), so these are identity tests, not
 * formatting tests. Two spellings that should normalise to one string and do
 * not mean one person with two accounts and two order histories.
 */

test('the shapes a Georgian number gets typed in all reach one string', () => {
  const expected = '+995555123456';
  for (const typed of [
    '555123456',
    '555 12 34 56',
    '555-12-34-56',
    '0555123456',
    '995555123456',
    '+995555123456',
    '+995 555 12 34 56',
    '  +995 (555) 12-34-56  ',
  ]) {
    assert.equal(normalizePhone(typed), expected, `${typed} should normalise to ${expected}`);
  }
});

test('nothing readable as a number returns null rather than a guess', () => {
  for (const input of [null, undefined, '', '   ', 'not a phone', '+', '--']) {
    assert.equal(normalizePhone(input), null);
  }
});

test('an explicit country code is never overwritten by the local default', () => {
  assert.equal(normalizePhone('+905321234567'), '+905321234567');
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123');
});

test('a number of the wrong length is rejected, not quietly accepted', () => {
  // This is the bug that seeded five accounts nobody could sign in to: the
  // string normalises into something that looks like E.164, and only a length
  // check tells you it is eight digits where nine were needed.
  const short = normalizePhone('+99555500001');
  assert.equal(short, '+99555500001', 'it still normalises');
  assert.equal(isMobileNumber(short), false, 'but it is not a number anyone can be texted at');

  assert.equal(isMobileNumber(normalizePhone('+995555000001')), true);
});

test('a landline cannot receive a code, so it is not a sign-in identity', () => {
  // Georgian landlines begin with 3; only 5XXXXXXXX is a mobile.
  assert.equal(isMobileNumber(normalizePhone('322555555')), false);
  assert.equal(isMobileNumber(normalizePhone('+995322555555')), false);
});

test('a foreign number is accepted on length alone', () => {
  // Refusing a customer with a real Turkish number would be a worse error than
  // letting one bad number through to the gateway.
  assert.equal(isMobileNumber('+905321234567'), true);
  assert.equal(isMobileNumber('+1234'), false);
  assert.equal(isMobileNumber('+1234567890123456'), false);
});

test('isMobileNumber refuses anything that is not normalised', () => {
  assert.equal(isMobileNumber(null), false);
  assert.equal(isMobileNumber('555123456'), false, 'a local form is not an identity');
});

test('the mask shows the last two digits and nothing else', () => {
  const masked = maskPhone('+995555123456');
  assert.equal(masked, '••• •• •• 56');
  assert.ok(!masked.includes('5551'), 'the subscriber part never appears');
  assert.equal(maskPhone(null), '');
});

test('formatting is for display and round-trips back to the stored form', () => {
  const stored = '+995555123456';
  const shown = formatPhone(stored);
  assert.equal(shown, '+995 555 12 34 56');
  assert.equal(normalizePhone(shown), stored);
});

test('a number that is not a local mobile is displayed as stored', () => {
  assert.equal(formatPhone('+905321234567'), '+905321234567');
  assert.equal(formatPhone(null), '');
});
