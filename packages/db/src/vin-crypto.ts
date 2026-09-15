import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { normalizeVin } from '@autoparts/core';

/**
 * VIN encryption at rest (docs/07 §7).
 *
 * Lives here rather than in the API so that everything writing a VIN row —
 * the API, the seed, future import jobs — uses one implementation. A second
 * implementation is how rows get written that the application cannot read back.
 *
 * Not in `core`: that package is shared with the web and mobile clients and has
 * to stay free of node: imports.
 *
 * Two representations, for two jobs:
 *  - `hash`: deterministic SHA-256, so the same VIN is findable across users
 *    without decrypting anything. This is what lets one VIN sit in several
 *    garages as a single decode (PRD §11).
 *  - `encrypt`: AES-256-GCM with a random IV, recoverable when genuinely
 *    needed. Non-deterministic by design, so two rows for the same VIN look
 *    unrelated at rest.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_SALT = 'autoparts:vin:v1';

export interface VinCipher {
  hash(vin: string): Buffer;
  encrypt(vin: string): Buffer;
  /** Returns null when the payload cannot be decrypted, rather than throwing. */
  decrypt(payload: Buffer): string | null;
}

export function createVinCipher(secret: string): VinCipher {
  // Stretched rather than used raw, so a short configured value still yields a
  // full-length key.
  const key = scryptSync(secret, KEY_SALT, 32);

  return {
    hash(vin) {
      return createHash('sha256').update(normalizeVin(vin)).digest();
    },

    encrypt(vin) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(normalizeVin(vin), 'utf8'),
        cipher.final(),
      ]);
      // iv | tag | ciphertext — self-contained, so no side table is needed.
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },

    decrypt(payload) {
      // A row written by an older key, or by something that did not encrypt at
      // all, must not take down the request that happened to read it. The
      // caller degrades to a null masked VIN; the vehicle data itself is
      // unaffected.
      if (payload.length <= IV_LENGTH + TAG_LENGTH) return null;
      try {
        const iv = payload.subarray(0, IV_LENGTH);
        const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
