/**
 * Log redaction (docs/07 §7).
 *
 * VIN, phone numbers, emails, tokens and card-shaped digits must never reach
 * a log line, an error report or an analytics event. This runs on every log
 * payload rather than relying on call sites to remember.
 */

const SENSITIVE_KEYS = new Set([
  'vin',
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'apikey',
  'api_key',
  'secret',
  'code',
  'codehash',
  'code_hash',
  'cardnumber',
  'card_number',
  'cvv',
  'pan',
  'phone',
  'email',
  'firstname',
  'first_name',
  'lastname',
  'last_name',
  'addressline',
  'address_line',
]);

const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[\w\-._~+/]+=*/gi;
const LONG_DIGITS_PATTERN = /\b\d{12,19}\b/g;

export const REDACTED = '[REDACTED]';

export function redactString(input: string): string {
  return input
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(VIN_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(LONG_DIGITS_PATTERN, REDACTED);
}

/**
 * Deep-redacts an object for logging. Returns a new value; the input is
 * never mutated. Cycles are handled, depth is capped.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}
