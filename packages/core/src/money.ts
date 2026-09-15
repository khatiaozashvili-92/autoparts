/**
 * Money — stored and passed around as integer minor units (ADR-005).
 *
 * 420.50 GEL is 42050 tetri. Never a float: `0.1 + 0.2 !== 0.3`, and in a
 * marketplace that difference is a settlement discrepancy.
 *
 * Over the wire amounts travel as strings so JavaScript's Number never
 * touches them; `bigint` is used in memory.
 */

export interface Money {
  /** Integer amount in the currency's minor unit. */
  readonly amountMinor: bigint;
  /** ISO-4217 alpha-3, uppercase. */
  readonly currency: string;
}

/** Wire representation — JSON has no bigint. */
export interface MoneyDto {
  readonly amountMinor: string;
  readonly currency: string;
}

const MINOR_UNIT_EXPONENT: Record<string, number> = {
  GEL: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
};

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2;
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine amounts in ${a} and ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export function money(amountMinor: bigint | number | string, currency: string): Money {
  const c = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new Error(`Invalid currency code: ${currency}`);
  return { amountMinor: BigInt(amountMinor), currency: c };
}

export function zero(currency: string): Money {
  return money(0n, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function multiply(a: Money, factor: number | bigint): Money {
  return { amountMinor: a.amountMinor * BigInt(factor), currency: a.currency };
}

export function sum(items: readonly Money[], currency: string): Money {
  return items.reduce<Money>(add, zero(currency));
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export function isNegative(m: Money): boolean {
  return m.amountMinor < 0n;
}

/**
 * Apply a percentage markup, rounding half-up to the nearest minor unit.
 *
 * Rounding is done on integers (no float arithmetic on the amount) so the
 * result is reproducible across runtimes. `percent` may be fractional —
 * e.g. 8.5 — and is scaled to 1/1000ths before the integer division.
 */
export function applyPercent(base: Money, percent: number): Money {
  const scaled = BigInt(Math.round(percent * 1000));
  const numerator = base.amountMinor * scaled;
  const denominator = 100_000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedUp = remainder * 2n >= denominator ? 1n : 0n;
  return { amountMinor: quotient + roundedUp, currency: base.currency };
}

export function toDto(m: Money): MoneyDto {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}

export function fromDto(d: MoneyDto): Money {
  return money(d.amountMinor, d.currency);
}

/**
 * Human-readable string. Formatting is locale-driven (PRD §80) — never
 * hardcode a currency symbol or a decimal separator.
 */
export function format(m: Money, locale = 'ka-GE'): string {
  const exp = minorUnitExponent(m.currency);
  const divisor = 10 ** exp;
  const value = Number(m.amountMinor) / divisor;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(value);
}

/** Parse a major-unit string ("420.50") into Money. For imports and admin input. */
export function parseMajor(input: string, currency: string): Money {
  const exp = minorUnitExponent(currency);
  const trimmed = input.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Not a valid amount: ${input}`);
  const negative = trimmed.startsWith('-');
  const [whole = '0', frac = ''] = trimmed.replace('-', '').split('.');
  const paddedFrac = frac.padEnd(exp, '0').slice(0, exp);
  const minor = BigInt(whole) * BigInt(10 ** exp) + BigInt(paddedFrac || '0');
  return money(negative ? -minor : minor, currency);
}
