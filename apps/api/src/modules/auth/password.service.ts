import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id password hashing (docs/07 §2).
 *
 * bcrypt is not used: Argon2id is the current recommendation against
 * GPU-accelerated cracking, and its memory cost is the part bcrypt lacks.
 * Parameters follow OWASP's minimum (19 MiB, 2 iterations, 1 lane).
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Rejecting the top passwords blocks the bulk of credential-stuffing hits. */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456789', '1234567890',
  'qwertyuiop', 'qwerty123', 'iloveyou', 'admin123', 'welcome123',
  'letmein123', 'football', 'baseball', 'superman', 'trustno1',
  'passw0rd', 'p@ssw0rd', 'abc123456', 'monkey123', '11111111',
]);

export const MIN_PASSWORD_LENGTH = 10;

@Injectable()
export class PasswordService {
  /** Returns an i18n key when the password is unacceptable, else null. */
  validate(password: string): string | null {
    if (password.length < MIN_PASSWORD_LENGTH) return 'error.password.tooShort';
    if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'error.password.tooCommon';
    // All-identical characters pass a length check but are trivially guessed.
    if (/^(.)\1+$/.test(password)) return 'error.password.tooSimple';
    return null;
  }

  async hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password, OPTIONS);
    } catch {
      // A malformed stored hash must read as "wrong password", never as a crash
      // that distinguishes this account from any other.
      return false;
    }
  }

  /** True when the stored hash used weaker parameters and should be upgraded. */
  needsRehash(storedHash: string): boolean {
    const match = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)/.exec(storedHash);
    if (!match) return true;
    const [, memory, time, lanes] = match;
    return (
      Number(memory) < OPTIONS.memoryCost ||
      Number(time) < OPTIONS.timeCost ||
      Number(lanes) < OPTIONS.parallelism
    );
  }
}
