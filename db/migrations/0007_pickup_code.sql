-- 0007_pickup_code
--
-- Stores the pickup code so the customer can reopen the order and see it again
-- (PRD §49), while the partner still verifies against a hash.
--
-- 0001 kept only `pickup_code_hash`, which is right for verification but makes
-- the code unreadable — a customer who closes the app would have no way back to
-- it. An encrypted copy keeps both properties: a database leak yields no usable
-- codes, and the owner can still be shown theirs.

BEGIN;

ALTER TABLE partner_orders
  ADD COLUMN pickup_code_enc bytea;

COMMENT ON COLUMN partner_orders.pickup_code_enc IS
  'AES-GCM, same cipher as VIN storage. Readable only to the order owner.';

-- The 24-hour no-show sweep scans this constantly (PRD §52).
CREATE INDEX partner_orders_ready
  ON partner_orders (ready_at)
  WHERE status = 'READY_FOR_PICKUP';

COMMIT;
