/**
 * Signing in, for the end-to-end suites.
 *
 * Every suite needs a token before it can test anything else, and since
 * ADR-015 getting one is two round trips rather than one. That belongs in one
 * place: six copies of the handshake would all have to be corrected together
 * the day the flow changes again.
 *
 * The code is read out of the API's response, which only works because the
 * suites run against a deployment configured with `SMS_PROVIDER=console` and
 * `OTP_ECHO_CODE=true`. Against a real gateway these tests cannot sign in at
 * all — correctly, since neither can anybody holding somebody else's phone.
 */

/**
 * The seeded development accounts, by the number that signs each one in.
 *
 * Kept in step with `devPhone()` in `packages/db/src/seed-users.ts` by hand
 * rather than imported, so the suites do not need that package built before
 * they can run. A drift fails loudly on the first sign-in, not quietly.
 */
export const DEV_PHONES = {
  customer: '555000001',
  partner: '555000002',
  partner2: '555000003',
  admin: '555000004',
  superAdmin: '555000005',
};

let counter = 0;

/**
 * A number no other account holds.
 *
 * Kept in the 59x range so it can never collide with the seeded 555 000 0xx
 * block, and derived from the clock so two runs a second apart do not fight
 * over the same account and its one-code-per-minute limit.
 */
export function uniquePhone() {
  const unique = (BigInt(Date.now()) * 100n + BigInt(counter++ % 100)) % 10_000_000n;
  return `59${String(unique).padStart(7, '0')}`;
}

/**
 * Runs the whole handshake and returns the tokens.
 *
 * `call` is the suite's own request helper — they each have one, and passing
 * it in keeps this module free of any opinion about the base URL or headers.
 */
export async function signIn(call, phone, { firstName } = {}) {
  const requested = await call('/auth/otp/request', { method: 'POST', body: { phone } });
  if (requested.status !== 200) {
    throw new Error(`OTP request for ${phone} failed: ${requested.status} ${requested.raw}`);
  }

  const { challengeId, devCode } = requested.body ?? {};
  if (!devCode) {
    throw new Error(
      `The API did not echo a code for ${phone}. The suites need SMS_PROVIDER=console ` +
        'and OTP_ECHO_CODE=true.',
    );
  }

  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    body: { challengeId, code: devCode, ...(firstName ? { firstName } : {}) },
  });
  if (verified.status !== 200) {
    throw new Error(`OTP verify for ${phone} failed: ${verified.status} ${verified.raw}`);
  }

  return {
    phone,
    token: verified.body.accessToken,
    refreshToken: verified.body.refreshToken,
    userId: verified.body.userId,
    isNewUser: verified.body.isNewUser,
  };
}

/** Signs in on a number nobody has used, which creates the account. */
export async function signInAsNewCustomer(call, { firstName } = {}) {
  return signIn(call, uniquePhone(), { firstName });
}

/** Just the access token, for the many places that need nothing else. */
export async function tokenFor(call, phone) {
  return (await signIn(call, phone)).token;
}
