-- Phone + one-time SMS code becomes the only way in (PRD §12, docs/07 §2).
--
-- Passwords are gone entirely, not merely optional. A stored password is a
-- liability the product never needed: every customer here already proves they
-- hold a Georgian mobile number, and a number is the identity the rest of the
-- system (order pickup, partner calls) is addressed to anyway.

-- ───────────────────────── one-time codes ─────────────────────────

-- Challenges are rows rather than cache entries on purpose. The attempt
-- counter and the consumed flag must survive an API restart, or a restart
-- would silently reset brute-force protection.
CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  -- HMAC, never the code. A database leak must not hand out live codes.
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  request_ip  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Serves both lookups the service makes: the newest challenge for a number,
-- and how many were issued to it in the last hour.
CREATE INDEX otp_challenges_phone_created_idx
  ON otp_challenges (phone, created_at DESC);

-- ───────────────────────── users ─────────────────────────

ALTER TABLE users DROP COLUMN password_hash;

-- The old constraint accepted an account with only an e-mail. Nothing can log
-- in that way any more, so the phone number is what has to be present.
ALTER TABLE users DROP CONSTRAINT users_identity_present;

-- NOT VALID on purpose: rows that pre-date this migration may have no phone
-- number, and there is no honest way to invent one. They are already locked
-- out — the password they used to sign in with no longer exists — and the
-- constraint still holds every row written from here on.
ALTER TABLE users
  ADD CONSTRAINT users_phone_present CHECK (phone IS NOT NULL) NOT VALID;
