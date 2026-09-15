/**
 * Identifier normalization — the backbone of MVP fitment (ADR-004).
 *
 * This is the ONLY place normalization is written. Import, search and matching
 * all call the same function; a second implementation elsewhere would silently
 * break matching the day the two drift apart (docs/06 §4.1).
 */

/**
 * '34 11 6 850 568' → '34116850568'
 * 'bp-2211/a'       → 'BP2211A'
 */
export function normalizeIdentifier(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s\-._/\\]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** Matches the DB CHECK constraint on product_identifiers.normalized. */
const NORMALIZED_SHAPE = /^[A-Z0-9]{3,50}$/;

export function isValidIdentifier(normalized: string): boolean {
  return NORMALIZED_SHAPE.test(normalized);
}

/* ─────────────────────────── VIN ─────────────────────────── */

/** I, O and Q never appear in a VIN — they are excluded to avoid confusion with 1 and 0. */
const VIN_ALLOWED = /^[A-HJ-NPR-Z0-9]{17}$/;

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const VIN_POSITION_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-]/g, '');
}

export interface VinValidation {
  valid: boolean;
  /** Present when the VIN is structurally wrong. */
  reason?: 'LENGTH' | 'CHARACTERS' | 'CHECKSUM';
  /** Whether a checksum was actually verifiable for this VIN. */
  checksumVerified: boolean;
}

/**
 * Structural validation (PRD §8). "17 characters" is not enough.
 *
 * The check digit is only mandated for North American VINs, so a failing
 * checksum on a non-NA VIN is not treated as invalid — it is simply
 * unverifiable. Rejecting those would lock out most European cars.
 */
export function validateVin(raw: string): VinValidation {
  const vin = normalizeVin(raw);

  if (vin.length !== 17) return { valid: false, reason: 'LENGTH', checksumVerified: false };
  if (!VIN_ALLOWED.test(vin)) return { valid: false, reason: 'CHARACTERS', checksumVerified: false };

  const checksumApplies = isNorthAmericanVin(vin);
  if (!checksumApplies) return { valid: true, checksumVerified: false };

  const expected = computeVinCheckDigit(vin);
  if (expected !== vin[8]) return { valid: false, reason: 'CHECKSUM', checksumVerified: true };

  return { valid: true, checksumVerified: true };
}

/**
 * WMI region: 1–5 are North America, where the check digit is mandatory.
 * Also the region that free NHTSA vPIC decodes well — the bulk of vehicles
 * imported into Georgia from Copart/IAAI/Manheim (ADR-003).
 */
export function isNorthAmericanVin(vin: string): boolean {
  const first = vin[0];
  return first !== undefined && first >= '1' && first <= '5';
}

export function computeVinCheckDigit(vin: string): string {
  let total = 0;
  for (let i = 0; i < 17; i++) {
    const char = vin[i];
    if (char === undefined) continue;
    const value = /\d/.test(char) ? Number(char) : (VIN_TRANSLITERATION[char] ?? 0);
    total += value * (VIN_POSITION_WEIGHTS[i] ?? 0);
  }
  const remainder = total % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

/** World Manufacturer Identifier — first three characters. */
export function vinWmi(vin: string): string {
  return normalizeVin(vin).slice(0, 3);
}

/**
 * VIN is never displayed in full (PRD §76, docs/07 §7).
 * 'WBA1J5C50FV123456' → 'WBA**********3456'
 */
export function maskVin(raw: string): string {
  const vin = normalizeVin(raw);
  if (vin.length !== 17) return '*'.repeat(Math.max(vin.length, 4));
  return `${vin.slice(0, 3)}${'*'.repeat(10)}${vin.slice(13)}`;
}
