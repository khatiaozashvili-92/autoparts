-- Three separate workspaces, and the data each one needs (PRD §77, docs/09, docs/10).
--
-- Two things change here.
--
-- 1. A partner company is created by the platform, never by itself. There is
--    no self-registration route and there must not be one: a partner is a
--    commercial relationship with a signed agreement behind it, so the row is
--    only ever written by a super admin.
--
-- 2. A partner may now add a product, not merely price one the platform
--    already listed. That is a real change to who owns the catalogue, and it
--    has to be reconciled with the promise the product is built on -- that a
--    customer is only ever shown parts confirmed to fit their exact car
--    (ADR-004). A product a partner invented has no fitment data at all, so
--    showing it would break exactly that promise.
--
--    So a partner-created product is inert until someone establishes what it
--    fits. `approved_at` is what the catalogue and search read; until it is
--    set the product exists, the partner can price and stock it, and no
--    customer ever sees it.

-- ───────────────────────── partner companies ─────────────────────────

-- Archived, not deleted. Offers, orders and audit rows reference a partner,
-- and a company that traded for a year cannot be made never to have existed.
ALTER TABLE partners ADD COLUMN archived_at timestamptz;

-- Every existing lookup of "the partners that count" now has to exclude these.
CREATE INDEX partners_active_idx ON partners (created_at) WHERE archived_at IS NULL;

-- ───────────────────────── catalogue provenance ─────────────────────────

-- Null for everything the platform curated itself.
ALTER TABLE products ADD COLUMN created_by_partner_id uuid REFERENCES partners(id);

-- Null means "not cleared for sale yet". Backfilled to now() for every product
-- that already exists, because those are the platform's own and were always
-- sellable -- leaving them null would empty the shop on deploy.
ALTER TABLE products ADD COLUMN approved_at timestamptz;
UPDATE products SET approved_at = created_at;

-- Who cleared it, for the audit trail. Null when the platform seeded it.
ALTER TABLE products ADD COLUMN approved_by uuid REFERENCES users(id);

-- The admin queue reads this: everything a partner added and nobody has
-- looked at yet.
CREATE INDEX products_pending_review_idx ON products (created_at)
  WHERE approved_at IS NULL;

-- A product nobody has approved must not be active, and the two must not be
-- able to drift apart. NOT VALID is not used: the backfill above already made
-- every existing row satisfy this.
ALTER TABLE products
  ADD CONSTRAINT product_active_requires_approval
  CHECK (approved_at IS NOT NULL OR active = false);

-- ───────────────────────── categories ─────────────────────────

-- The super admin can retire a category without breaking the master parts
-- filed under it. `active` already exists; this records who last touched it.
ALTER TABLE categories ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
