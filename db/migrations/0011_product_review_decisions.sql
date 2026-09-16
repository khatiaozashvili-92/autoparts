-- Rejection has to be a state, not the absence of approval.
--
-- Migration 0009 gave a partner-created product one review column,
-- `approved_at`, and the admin queue read "null means nobody has looked at it
-- yet". That made approval expressible and rejection not: refusing a product
-- wrote `approved_at = NULL, active = false`, which is precisely the row the
-- partner's upload already created. The decision left no trace, the product
-- never left the queue, and the reviewer pressing the button saw nothing
-- happen -- correctly concluding it was broken.
--
-- So a review now has three outcomes and the row can tell them apart:
--
--   approved_at set   -- cleared for sale
--   rejected_at set   -- refused, with a reason the partner can read
--   neither           -- waiting for somebody
--
-- The reason is not decoration. A partner whose product is refused with no
-- explanation can only guess and re-upload the same thing, which turns one
-- rejection into an endless queue.

ALTER TABLE products ADD COLUMN rejected_at timestamptz;
ALTER TABLE products ADD COLUMN rejected_by uuid REFERENCES users(id);
ALTER TABLE products ADD COLUMN review_note text;

-- A product cannot be both cleared and refused. Without this the two columns
-- drift the first time somebody approves a rejected product without clearing
-- the rejection, and then no query can say which decision was the live one.
ALTER TABLE products
  ADD CONSTRAINT product_review_is_one_decision
  CHECK (approved_at IS NULL OR rejected_at IS NULL);

-- The queue is what nobody has decided yet, so a refused product has to leave
-- it. The old index, which only knew about approval, would otherwise keep
-- serving rejected rows back to the reviewer who just refused them.
DROP INDEX IF EXISTS products_pending_review_idx;
CREATE INDEX products_pending_review_idx ON products (created_at)
  WHERE approved_at IS NULL AND rejected_at IS NULL;

-- Refused products are read as their own list -- the reviewer needs to be able
-- to find one and put it back, because a rejection made in error is otherwise
-- unrecoverable except by asking the partner to upload it a second time.
CREATE INDEX products_rejected_idx ON products (rejected_at DESC)
  WHERE rejected_at IS NOT NULL;
