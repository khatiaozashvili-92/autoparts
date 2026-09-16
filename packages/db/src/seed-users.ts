import { isMobileNumber, normalizePhone } from '@autoparts/core';
import type { PoolClient } from 'pg';

/**
 * Development accounts.
 *
 * Seeded so partner and admin flows can be exercised without clicking through
 * an approval queue first. Guarded against production in `seed()` — these are
 * published numbers, and creating them on a live system would be a way in.
 *
 * There are no passwords any more (ADR-015). Signing in as one of these means
 * asking for a code on its number and reading the code out of the API log, or
 * off the login page while `OTP_ECHO_CODE` is on.
 */

/**
 * Reserved for fiction. Georgian mobile numbers are nine digits beginning with
 * 5, and 555 00 00 XX is not issued to a subscriber — so a stray SMS from a
 * misconfigured staging deployment cannot reach a real person.
 *
 * Written as the local nine-digit form and normalised below rather than
 * hand-assembled into E.164: counting digits inside a `+995…` literal is how
 * this table ends up holding numbers that look right and cannot sign in.
 *
 * `DEV_PHONES` in `tests/lib/auth.mjs` and the table in the README spell the
 * same numbers out; change all three together.
 */
export const devPhone = (n: number): string => `5550000${String(n).padStart(2, '0')}`;

export interface DevAccount {
  /** Local nine-digit form; normalised to E.164 by `seedUsers`. */
  phone: string;
  /** Kept for correspondence and for the admin console's search box. */
  email: string;
  role: 'CUSTOMER' | 'PARTNER_ADMIN' | 'PLATFORM_ADMIN' | 'SUPER_ADMIN';
  partnerLegalName?: string;
  firstName: string;
}

export const DEV_ACCOUNTS: DevAccount[] = [
  {
    phone: devPhone(1),
    email: 'customer@autoparts.dev',
    role: 'CUSTOMER',
    firstName: 'Khatia',
  },
  {
    phone: devPhone(2),
    email: 'partner@autoparts.dev',
    role: 'PARTNER_ADMIN',
    partnerLegalName: 'Auto Motors LLC',
    firstName: 'Auto Motors',
  },
  {
    phone: devPhone(3),
    email: 'partner2@autoparts.dev',
    role: 'PARTNER_ADMIN',
    partnerLegalName: 'Tbilisi Parts Center LLC',
    firstName: 'Parts Center',
  },
  {
    phone: devPhone(4),
    email: 'admin@autoparts.dev',
    role: 'PLATFORM_ADMIN',
    firstName: 'Platform',
  },
  {
    phone: devPhone(5),
    email: 'super@autoparts.dev',
    role: 'SUPER_ADMIN',
    firstName: 'Super',
  },
];

export async function seedUsers(
  c: PoolClient,
  partnerIdFor: (legalName: string) => string,
): Promise<number> {
  for (const account of DEV_ACCOUNTS) {
    // Normalised through the same function the API uses, so a typo in the
    // table above fails here rather than producing an account nobody can
    // sign in to.
    // Checked, not merely normalised: a number of the wrong length still
    // normalises happily into something that looks like E.164, and would seed
    // an account no code can ever be sent to.
    const phone = normalizePhone(account.phone);
    if (!phone || !isMobileNumber(phone)) {
      throw new Error(`Dev account ${account.email} has an invalid phone number: ${account.phone}`);
    }

    // A database seeded before ADR-015 holds these accounts with an e-mail and
    // no phone number. Claim those rows first: without this the INSERT below
    // trips the e-mail unique key, which ON CONFLICT (phone) cannot catch.
    await c.query(
      `UPDATE users SET phone = $1, phone_verified_at = now()
       WHERE email = $2 AND phone IS NULL`,
      [phone, account.email],
    );

    // Conflicting on the phone number, not the e-mail: the number is the
    // identity now, so it is the column a re-run has to agree with.
    const [user] = (
      await c.query<{ id: string }>(
        `INSERT INTO users (phone, email, first_name, locale, phone_verified_at, email_verified_at)
         VALUES ($1, $2, $3, 'ka', now(), now())
         ON CONFLICT (phone) DO UPDATE
           SET email = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               phone_verified_at = now()
         RETURNING id`,
        [phone, account.email, account.firstName],
      )
    ).rows;
    if (!user) continue;

    const partnerId = account.partnerLegalName ? partnerIdFor(account.partnerLegalName) : null;

    await c.query(
      `INSERT INTO user_roles (user_id, role, partner_id)
       VALUES ($1, $2::user_role, $3)
       ON CONFLICT DO NOTHING`,
      [user.id, account.role, partnerId],
    );

    if (partnerId) {
      await c.query(
        `INSERT INTO partner_users (partner_id, user_id, is_admin)
         VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [partnerId, user.id],
      );
    }
  }

  return DEV_ACCOUNTS.length;
}
