import { hash, Algorithm } from '@node-rs/argon2';
import type { PoolClient } from 'pg';

/**
 * Development accounts.
 *
 * Seeded so partner and admin flows can be exercised without clicking through
 * an approval queue first. Guarded against production in `seed()` — these are
 * published credentials, and creating them on a live system would be a way in.
 */
export const DEV_PASSWORD = 'dev-password-change-me';

export interface DevAccount {
  email: string;
  role: 'CUSTOMER' | 'PARTNER_ADMIN' | 'PLATFORM_ADMIN' | 'SUPER_ADMIN';
  partnerLegalName?: string;
  firstName: string;
}

export const DEV_ACCOUNTS: DevAccount[] = [
  { email: 'customer@autoparts.dev', role: 'CUSTOMER', firstName: 'Khatia' },
  {
    email: 'partner@autoparts.dev',
    role: 'PARTNER_ADMIN',
    partnerLegalName: 'Auto Motors LLC',
    firstName: 'Auto Motors',
  },
  {
    email: 'partner2@autoparts.dev',
    role: 'PARTNER_ADMIN',
    partnerLegalName: 'Tbilisi Parts Center LLC',
    firstName: 'Parts Center',
  },
  { email: 'admin@autoparts.dev', role: 'PLATFORM_ADMIN', firstName: 'Platform' },
  { email: 'super@autoparts.dev', role: 'SUPER_ADMIN', firstName: 'Super' },
];

export async function seedUsers(
  c: PoolClient,
  partnerIdFor: (legalName: string) => string,
): Promise<number> {
  const passwordHash = await hash(DEV_PASSWORD, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const account of DEV_ACCOUNTS) {
    const [user] = (
      await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, first_name, locale, email_verified_at)
         VALUES ($1, $2, $3, 'ka', now())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [account.email, passwordHash, account.firstName],
      )
    ).rows;
    if (!user) continue;

    const partnerId = account.partnerLegalName
      ? partnerIdFor(account.partnerLegalName)
      : null;

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
