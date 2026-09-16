/**
 * Phone normalization — the backbone of authentication (ADR-015).
 *
 * The number *is* the account, so exactly one spelling of it may ever reach
 * the database. `+995 555 12 34 56`, `995555123456` and `555123456` are one
 * customer; storing them as three would let the same person register three
 * times and would hand each of them a different order history.
 *
 * Like `normalizeIdentifier`, this is the only implementation. The API, the
 * seed, both clients and the tests import it rather than re-deriving it.
 */

/** The deployment's default country. Georgia for the initial market (PRD §3). */
const DEFAULT_CALLING_CODE = '995';

/**
 * Georgian mobile numbers are nine digits and always begin with 5; landlines
 * begin with 3 and cannot receive an SMS. Rejecting a landline at the door is
 * kinder than sending a code into a void and blaming the customer for not
 * receiving it.
 */
const GE_MOBILE = /^5\d{8}$/;

/**
 * '555 12 34 56'   → '+995555123456'
 * '+995 555123456' → '+995555123456'
 * '995555123456'   → '+995555123456'
 *
 * Returns null when the input cannot be read as a phone number at all. A
 * number that normalises but belongs to another country is returned as typed
 * in E.164 — `isMobileNumber` is what decides whether we can text it.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Strip everything a person might type as decoration, keeping a leading '+'.
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\+/g, '');
  if (!digits) return null;

  // Explicit international form wins over any local guess.
  if (cleaned.startsWith('+')) return `+${digits}`;
  if (digits.startsWith(DEFAULT_CALLING_CODE) && digits.length > 9) return `+${digits}`;

  // A bare nine-digit local number is read as a number in the default country.
  if (digits.length === 9) return `+${DEFAULT_CALLING_CODE}${digits}`;

  // A local number written with a trunk prefix: 0555123456.
  if (digits.length === 10 && digits.startsWith('0')) {
    return `+${DEFAULT_CALLING_CODE}${digits.slice(1)}`;
  }

  return `+${digits}`;
}

/**
 * Whether a normalised number can receive an SMS.
 *
 * Only the default country's rules are encoded, because only its numbers can
 * be checked honestly. Foreign numbers are accepted on length alone rather
 * than blocked — refusing a customer with a real Turkish number would be a
 * worse error than letting one bad number through to the gateway.
 */
export function isMobileNumber(normalized: string | null): boolean {
  if (!normalized || !normalized.startsWith('+')) return false;
  const digits = normalized.slice(1);

  if (digits.startsWith(DEFAULT_CALLING_CODE)) {
    return GE_MOBILE.test(digits.slice(DEFAULT_CALLING_CODE.length));
  }

  return digits.length >= 8 && digits.length <= 15;
}

/**
 * '+995555123456' → '+995 555 12 34 56'
 *
 * Display only. Never store this, and never send it to the gateway.
 */
export function formatPhone(normalized: string | null): string {
  if (!normalized) return '';
  const digits = normalized.replace(/^\+/, '');
  if (!digits.startsWith(DEFAULT_CALLING_CODE)) return normalized;

  const local = digits.slice(DEFAULT_CALLING_CODE.length);
  if (!GE_MOBILE.test(local)) return normalized;

  return `+${DEFAULT_CALLING_CODE} ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7)}`;
}

/**
 * '+995555123456' → '*** ** ** 56'
 *
 * What the "we sent a code to …" line shows. The full number is not echoed
 * back: on a shared screen it would confirm to a bystander which number is
 * registered (docs/07 §6.2).
 */
export function maskPhone(normalized: string | null): string {
  if (!normalized) return '';
  const digits = normalized.replace(/^\+/, '');
  if (digits.length < 4) return '••';
  return `••• •• •• ${digits.slice(-2)}`;
}
