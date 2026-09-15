-- 0001_initial_schema
--
-- Full initial schema. Source: docs/03-database-schema.md.
--
-- Conventions (docs/03 §1):
--   * primary keys are uuid
--   * money is bigint in the currency's minor unit + char(3) ISO-4217 (ADR-005)
--   * timestamps are timestamptz, always stored UTC
--   * the data-quality rules of docs/01 §7 are enforced here as constraints,
--     not only in application code
--
-- Three corrections against the document, which described constraints
-- PostgreSQL cannot express as written:
--   * PRIMARY KEY / UNIQUE table constraints cannot contain expressions such
--     as COALESCE(); those are unique INDEXes instead (user_roles, master_parts)
--   * citext was used for e-mail without enabling the extension
--   * the offer_availability view must be created after reservations exists

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid, digest
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive e-mail
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- typo tolerance fallback
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───────────────────────────── enums ─────────────────────────────

CREATE TYPE user_role AS ENUM (
  'CUSTOMER','PARTNER_USER','PARTNER_ADMIN',
  'PLATFORM_SUPPORT','PLATFORM_ADMIN','SUPER_ADMIN');

CREATE TYPE partner_status    AS ENUM ('PENDING','APPROVED','SUSPENDED','REJECTED');
CREATE TYPE brand_type        AS ENUM ('ORIGINAL_OEM','AFTERMARKET','UNKNOWN');
CREATE TYPE product_condition AS ENUM ('NEW','USED','REFURBISHED');

CREATE TYPE availability_status AS ENUM ('IN_STOCK','AVAILABLE_TO_ORDER','UNAVAILABLE');

-- Order matters: docs/05 §3. ADMIN_MANUAL outranks every provider because it
-- is human-verified knowledge, usually created because a provider was wrong.
CREATE TYPE fitment_source AS ENUM (
  'ADMIN_MANUAL','PROVIDER_VIN','PROVIDER_CONFIG',
  'OEM_MATCH','TECHNICAL_DATA','PARTNER_DECLARED');

CREATE TYPE fitment_verdict AS ENUM (
  'EXACT','COMPATIBLE','CONDITIONAL','UNCERTAIN','NOT_COMPATIBLE');

CREATE TYPE conflict_status   AS ENUM ('OPEN','APPROVED','REJECTED','MAPPED');
CREATE TYPE integration_mode  AS ENUM ('API','CSV','MANUAL');
CREATE TYPE sync_status       AS ENUM ('SUCCESS','PARTIAL','FAILED','RUNNING');
CREATE TYPE reservation_status AS ENUM ('ACTIVE','CONSUMED','EXPIRED','RELEASED');

CREATE TYPE order_status AS ENUM (
  'DRAFT','STOCK_RESERVED','AWAITING_PAYMENT','PAID','CONFIRMED',
  'PREPARING','READY_FOR_PICKUP','PICKED_UP','COMPLETED',
  'CANCELLED','FAILED','REFUNDED');

CREATE TYPE payment_status AS ENUM (
  'PENDING','AUTHORIZED','CAPTURED','FAILED','CANCELLED',
  'REFUNDED','PARTIALLY_REFUNDED');

CREATE TYPE settlement_status    AS ENUM ('PENDING','PROCESSING','PAID','FAILED');
CREATE TYPE delivery_method      AS ENUM ('PICKUP','COURIER');
CREATE TYPE payment_terms        AS ENUM ('FULL_PREPAYMENT','PARTIAL_ADVANCE','PAY_ON_ARRIVAL','OTHER');
CREATE TYPE request_status       AS ENUM ('OPEN','ANSWERED','CLOSED','EXPIRED');
CREATE TYPE notification_channel AS ENUM ('IN_APP','SMS','EMAIL','PUSH');
CREATE TYPE identifier_kind      AS ENUM ('OEM','MPN','SKU','EAN');

-- ───────────────────────── users & auth ─────────────────────────

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext UNIQUE,
  phone             text UNIQUE,
  password_hash     text,
  first_name        text,
  last_name         text,
  locale            text NOT NULL DEFAULT 'ka',
  country           char(2) NOT NULL DEFAULT 'GE',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  suspended_at      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_present CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE auth_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  provider_uid text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE partners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name         text NOT NULL,
  display_name       text NOT NULL,
  tax_id             text,
  status             partner_status NOT NULL DEFAULT 'PENDING',
  integration_mode   integration_mode NOT NULL DEFAULT 'MANUAL',
  country            char(2) NOT NULL DEFAULT 'GE',
  currency           char(3) NOT NULL DEFAULT 'GEL',
  contact_email      citext,
  contact_phone      text,
  -- Per-partner field names for CSV/API import, so onboarding a partner
  -- needs no deploy (docs/06 §1).
  field_mapping      jsonb NOT NULL DEFAULT '{}',
  stock_reliability  numeric(5,4) NOT NULL DEFAULT 1.0,
  order_success_rate numeric(5,4),
  approved_at        timestamptz,
  suspended_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_reliability_range CHECK (stock_reliability BETWEEN 0 AND 1),
  CONSTRAINT partner_currency_iso CHECK (currency ~ '^[A-Z]{3}$')
);

-- A composite PK cannot contain COALESCE(), so uniqueness lives in an index.
CREATE TABLE user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       user_role NOT NULL,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id),
  -- A partner role without a partner would be unscoped, which is exactly the
  -- cross-partner read docs/07 §5.1 exists to prevent.
  CONSTRAINT partner_role_needs_partner CHECK (
    (role IN ('PARTNER_USER','PARTNER_ADMIN')) = (partner_id IS NOT NULL))
);
CREATE UNIQUE INDEX user_roles_unique
  ON user_roles (user_id, role, COALESCE(partner_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX user_roles_by_user ON user_roles (user_id);

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,     -- the raw token is never stored
  device_id  text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_by_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  destination text NOT NULL,
  code_hash   text NOT NULL,
  purpose     text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_purpose_valid CHECK (purpose IN ('LOGIN','VERIFY','RESET'))
);
CREATE INDEX otp_pending ON otp_codes (destination, purpose) WHERE consumed_at IS NULL;

-- ───────────────────────── vehicles & VIN ─────────────────────────

-- One VIN can sit in several users' garages (PRD §11), so the VIN and its
-- decoded configuration are shared and only the garage entry is per-user.
-- A VIN is therefore decoded once no matter how many people own the car.
CREATE TABLE vins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin_hash   bytea NOT NULL UNIQUE,   -- sha256(upper(vin)) — lookups
  vin_enc    bytea NOT NULL,          -- encrypted VIN, app-level key
  wmi        char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE vins IS
  'VIN is never stored in plaintext and never returned in full by the API (PRD §76).';

CREATE TABLE vehicle_configurations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin_id          uuid REFERENCES vins(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  provider_ref    text,
  make            text NOT NULL,
  model           text NOT NULL,
  model_year      int NOT NULL,
  generation      text,
  engine          text,
  engine_code     text,
  fuel_type       text,
  transmission    text,
  drive_type      text,
  body_type       text,
  trim            text,
  -- Mandatory for fitment, not optional: US-spec and EU-spec parts of the same
  -- model differ, and both circulate in Georgia (ADR-003, docs/05 §4.1).
  market          char(2),
  production_from date,
  production_to   date,
  raw             jsonb NOT NULL DEFAULT '{}',
  decoded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT veh_conf_year_sane CHECK (model_year BETWEEN 1950 AND 2100)
);
CREATE INDEX veh_conf_by_vin ON vehicle_configurations (vin_id);
CREATE INDEX veh_conf_by_model ON vehicle_configurations (make, model, model_year);

CREATE TABLE vehicles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin_id             uuid REFERENCES vins(id),
  configuration_id   uuid REFERENCES vehicle_configurations(id),
  custom_name        text,
  -- Kept apart on purpose: what the provider confirmed vs what the owner said.
  -- The engine weights them differently (docs/05 §5), and merging them would
  -- lose the ability to tell knowledge from guesswork.
  verified_data      jsonb NOT NULL DEFAULT '{}',
  user_supplied_data jsonb NOT NULL DEFAULT '{}',
  is_default         boolean NOT NULL DEFAULT false,
  last_used_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX vehicles_user_vin_unique ON vehicles (user_id, vin_id)
  WHERE deleted_at IS NULL AND vin_id IS NOT NULL;
CREATE UNIQUE INDEX one_default_vehicle_per_user ON vehicles (user_id)
  WHERE is_default AND deleted_at IS NULL;
CREATE INDEX vehicles_by_user ON vehicles (user_id) WHERE deleted_at IS NULL;

-- ───────────────────────── partner locations ─────────────────────────

CREATE TABLE partner_locations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name                text NOT NULL,
  address_line        text NOT NULL,
  city                text NOT NULL,
  country             char(2) NOT NULL,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  working_hours       jsonb NOT NULL DEFAULT '{}',
  pickup_instructions text,
  phone               text,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_locations_active ON partner_locations (partner_id) WHERE active;

CREATE TABLE partner_users (
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, user_id)
);

-- ───────────────────────────── catalog ─────────────────────────────

CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid REFERENCES categories(id),
  slug       text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  -- Which vehicle attributes the fitment engine needs before it can decide
  -- anything in this category (docs/05 §4 step 2).
  required_vehicle_attributes text[] NOT NULL DEFAULT '{}',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Names live in their own table so nothing user-visible is hardcoded (PRD §80).
CREATE TABLE category_translations (
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  name        text NOT NULL,
  synonyms    text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (category_id, locale)
);

CREATE TABLE brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  brand_type      brand_type NOT NULL DEFAULT 'AFTERMARKET',
  logo_url        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE master_parts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES categories(id),
  normalized_name text NOT NULL,
  position        text,
  axle            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- docs/01 §7: no duplicate master products. Expression form requires an index.
CREATE UNIQUE INDEX master_parts_unique ON master_parts
  (category_id, normalized_name, COALESCE(position,''), COALESCE(axle,''));

CREATE TABLE master_part_translations (
  master_part_id uuid NOT NULL REFERENCES master_parts(id) ON DELETE CASCADE,
  locale         text NOT NULL,
  name           text NOT NULL,
  synonyms       text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (master_part_id, locale)
);

CREATE TABLE return_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          text NOT NULL,
  partner_id     uuid REFERENCES partners(id) ON DELETE CASCADE,
  product_id     uuid,
  window_days    int NOT NULL,
  conditions_key text NOT NULL,       -- i18n key, never raw copy
  version        int NOT NULL DEFAULT 1,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT return_policy_scope CHECK (scope IN ('PLATFORM','PARTNER','PRODUCT')),
  CONSTRAINT return_policy_window CHECK (window_days >= 0)
);

CREATE TABLE products (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_part_id     uuid NOT NULL REFERENCES master_parts(id),
  brand_id           uuid NOT NULL REFERENCES brands(id),
  name               text NOT NULL,
  description        text,
  condition          product_condition NOT NULL DEFAULT 'NEW',
  warranty_months    int,
  specifications     jsonb NOT NULL DEFAULT '{}',
  country_of_origin  char(2),
  installation_notes text,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- MVP sells NEW only (PRD §22); the enum already knows the other two so P1
  -- needs no migration.
  CONSTRAINT product_condition_mvp CHECK (condition = 'NEW' OR active = false)
);
CREATE INDEX products_by_master_part ON products (master_part_id);
CREATE INDEX products_by_brand ON products (brand_id);

ALTER TABLE return_policies
  ADD CONSTRAINT return_policies_product_fk
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

CREATE TABLE product_identifiers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind       identifier_kind NOT NULL,
  value      text NOT NULL,
  normalized text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identifier_shape CHECK (normalized ~ '^[A-Z0-9]{3,50}$'),
  UNIQUE (kind, normalized, product_id)
);
-- The backbone of MVP fitment (ADR-004), so it gets its own indexes.
CREATE INDEX product_identifiers_normalized ON product_identifiers (normalized);
CREATE INDEX product_identifiers_kind_norm ON product_identifiers (kind, normalized);

CREATE TABLE product_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_by_product ON product_images (product_id);

-- ───────────────────────────── fitment ─────────────────────────────

CREATE TABLE fitments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source          fitment_source NOT NULL,
  partner_id      uuid REFERENCES partners(id),
  make            text NOT NULL,
  model           text,
  year_from       int,
  year_to         int,
  generation      text,
  engine_code     text,
  transmission    text,
  drive_type      text,
  body_type       text,
  trim            text,
  market          char(2),
  production_from date,
  production_to   date,
  axle            text,
  position        text,
  conditions      jsonb NOT NULL DEFAULT '{}',
  verdict         fitment_verdict NOT NULL DEFAULT 'COMPATIBLE',
  confidence      numeric(4,3) NOT NULL DEFAULT 0.5,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitment_year_range CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to),
  CONSTRAINT fitment_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT partner_declared_has_partner CHECK (
    source <> 'PARTNER_DECLARED' OR partner_id IS NOT NULL)
);
CREATE INDEX fitments_by_product ON fitments (product_id) WHERE active;
CREATE INDEX fitments_by_vehicle ON fitments (make, model, year_from, year_to) WHERE active;
CREATE INDEX fitments_by_source ON fitments (source);

CREATE TABLE fitment_conflicts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  configuration_id uuid REFERENCES vehicle_configurations(id),
  partner_id       uuid REFERENCES partners(id),
  claimed_verdict  fitment_verdict NOT NULL,
  provider_verdict fitment_verdict NOT NULL,
  provider_name    text,
  status           conflict_status NOT NULL DEFAULT 'OPEN',
  resolution_note  text,
  resolved_by      uuid REFERENCES users(id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fitment_conflicts_open ON fitment_conflicts (created_at) WHERE status = 'OPEN';

-- Without this table the "Fitment Accuracy" KPI (PRD §61) cannot be measured
-- at all. It is the product's first priority, so every verdict is logged.
CREATE TABLE fitment_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  configuration_id uuid REFERENCES vehicle_configurations(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  verdict          fitment_verdict NOT NULL,
  winning_source   fitment_source NOT NULL,
  confidence       numeric(4,3) NOT NULL,
  reasons          jsonb NOT NULL DEFAULT '[]',
  order_item_id    uuid,             -- filled in if it was bought
  was_correct      boolean,          -- filled in from a return or dispute
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fitment_checks_by_time ON fitment_checks (created_at);
CREATE INDEX fitment_checks_by_product ON fitment_checks (product_id, verdict);

-- ─────────────────────── inventory & offers ───────────────────────

CREATE TABLE offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  product_id            uuid NOT NULL REFERENCES products(id),
  location_id           uuid REFERENCES partner_locations(id),
  partner_sku           text,
  base_price_minor      bigint NOT NULL,
  platform_markup_minor bigint NOT NULL DEFAULT 0,
  -- What the customer pays. Derived, so it can never drift from its parts
  -- (ADR-001).
  customer_price_minor  bigint GENERATED ALWAYS AS
                          (base_price_minor + platform_markup_minor) STORED,
  currency              char(3) NOT NULL DEFAULT 'GEL',
  stock_quantity        int NOT NULL DEFAULT 0,
  availability_status   availability_status NOT NULL DEFAULT 'UNAVAILABLE',
  expected_availability_days int,
  payment_terms         payment_terms NOT NULL DEFAULT 'FULL_PREPAYMENT',
  warranty_months       int,
  return_policy_id      uuid REFERENCES return_policies(id),
  stock_reliability     numeric(5,4) NOT NULL DEFAULT 1.0,
  last_synced_at        timestamptz NOT NULL DEFAULT now(),
  is_stale              boolean NOT NULL DEFAULT false,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_price_nonneg CHECK (base_price_minor >= 0 AND platform_markup_minor >= 0),
  CONSTRAINT offer_stock_nonneg CHECK (stock_quantity >= 0),
  CONSTRAINT offer_currency_iso CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX offers_partner_product_location ON offers
  (partner_id, product_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX offers_by_product ON offers (product_id) WHERE active;
CREATE INDEX offers_by_partner ON offers (partner_id) WHERE active;
CREATE INDEX offers_by_availability ON offers (availability_status) WHERE active;

CREATE TABLE price_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         uuid REFERENCES partners(id) ON DELETE CASCADE,
  category_id        uuid REFERENCES categories(id) ON DELETE CASCADE,
  markup_percent     numeric(6,3),
  markup_fixed_minor bigint,
  currency           char(3),
  priority           int NOT NULL DEFAULT 0,
  active             boolean NOT NULL DEFAULT true,
  valid_from         timestamptz NOT NULL DEFAULT now(),
  valid_to           timestamptz,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_rule_has_value
    CHECK (markup_percent IS NOT NULL OR markup_fixed_minor IS NOT NULL),
  CONSTRAINT price_rule_nonneg
    CHECK (COALESCE(markup_percent, 0) >= 0 AND COALESCE(markup_fixed_minor, 0) >= 0)
);
CREATE INDEX price_rules_active ON price_rules (partner_id, category_id) WHERE active;

CREATE TABLE inventory_syncs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  mode        integration_mode NOT NULL,
  status      sync_status NOT NULL,
  rows_total  int NOT NULL DEFAULT 0,
  rows_ok     int NOT NULL DEFAULT 0,
  rows_failed int NOT NULL DEFAULT 0,
  errors      jsonb NOT NULL DEFAULT '[]',   -- [{row, column, code, message}]
  file_url    text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX inventory_syncs_recent ON inventory_syncs (partner_id, started_at DESC);

CREATE TABLE inventory_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id          uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  believed_quantity int NOT NULL,
  actual_quantity   int,
  matched           boolean,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  context           text NOT NULL,
  CONSTRAINT inventory_check_context
    CHECK (context IN ('PRE_RESERVE','PRE_PAYMENT','SYNC'))
);
CREATE INDEX inventory_checks_by_time ON inventory_checks (checked_at);

-- ──────────────────── cart, reservations, orders ────────────────────

CREATE TABLE carts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_cart_per_user ON carts (user_id);

CREATE TABLE cart_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  offer_id   uuid NOT NULL REFERENCES offers(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  quantity   int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_item_qty CHECK (quantity > 0),
  UNIQUE (cart_id, offer_id, vehicle_id)
);

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number          text NOT NULL UNIQUE,
  user_id               uuid NOT NULL REFERENCES users(id),
  vehicle_id            uuid REFERENCES vehicles(id),
  status                order_status NOT NULL DEFAULT 'DRAFT',
  delivery_method       delivery_method NOT NULL DEFAULT 'PICKUP',
  subtotal_minor        bigint NOT NULL,
  markup_minor          bigint NOT NULL,
  total_minor           bigint NOT NULL,
  currency              char(3) NOT NULL,
  payment_status        payment_status NOT NULL DEFAULT 'PENDING',
  return_policy_version int,
  cancellation_deadline timestamptz,
  ready_for_pickup_at   timestamptz,
  pickup_deadline       timestamptz,   -- ready_for_pickup_at + 24h (PRD §52)
  picked_up_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_total_consistent CHECK (total_minor = subtotal_minor + markup_minor),
  CONSTRAINT order_amounts_nonneg CHECK (subtotal_minor >= 0 AND markup_minor >= 0)
);
CREATE INDEX orders_by_user ON orders (user_id, created_at DESC);
CREATE INDEX orders_by_status ON orders (status);
CREATE INDEX pickup_deadline_watch ON orders (pickup_deadline)
  WHERE status = 'READY_FOR_PICKUP';

CREATE TABLE reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  quantity    int NOT NULL,
  status      reservation_status NOT NULL DEFAULT 'ACTIVE',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  released_at timestamptz,
  CONSTRAINT reservation_qty CHECK (quantity > 0)
);
CREATE INDEX active_reservations ON reservations (offer_id) WHERE status = 'ACTIVE';
CREATE INDEX expiring_reservations ON reservations (expires_at) WHERE status = 'ACTIVE';

-- Multi-vendor from day one even though MVP allows a single partner per
-- checkout (PRD §41): P1 then drops one index instead of migrating orders.
CREATE TABLE partner_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_id       uuid NOT NULL REFERENCES partners(id),
  location_id      uuid REFERENCES partner_locations(id),
  status           order_status NOT NULL DEFAULT 'CONFIRMED',
  subtotal_minor   bigint NOT NULL,
  markup_minor     bigint NOT NULL,
  total_minor      bigint NOT NULL,
  currency         char(3) NOT NULL,
  pickup_code_hash bytea,             -- the QR payload itself is never stored
  ready_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_order_total CHECK (total_minor = subtotal_minor + markup_minor)
);
CREATE INDEX partner_orders_queue ON partner_orders (partner_id, status);
-- PRD §40: one checkout, one partner. Dropping this index is the whole of the
-- P1 multi-vendor change at the schema level.
CREATE UNIQUE INDEX mvp_single_partner_per_order ON partner_orders (order_id);

CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_order_id uuid NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
  offer_id         uuid NOT NULL REFERENCES offers(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  vehicle_id       uuid REFERENCES vehicles(id),
  quantity         int NOT NULL,
  -- Prices are frozen at purchase time; a later markup change must not
  -- rewrite history (docs/08 §3).
  base_price_minor bigint NOT NULL,
  markup_minor     bigint NOT NULL,
  line_total_minor bigint NOT NULL,
  currency         char(3) NOT NULL,
  -- The verdict at the moment of sale: evidence if the fit is disputed.
  fitment_verdict  fitment_verdict NOT NULL,
  fitment_check_id uuid REFERENCES fitment_checks(id),
  product_snapshot jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_item_qty CHECK (quantity > 0),
  -- R1 at the storage layer: an unconfirmed fit can never become a sale.
  CONSTRAINT order_item_sellable_fitment
    CHECK (fitment_verdict IN ('EXACT','COMPATIBLE','CONDITIONAL'))
);
CREATE INDEX order_items_by_order ON order_items (order_id);
CREATE INDEX order_items_by_partner_order ON order_items (partner_order_id);

ALTER TABLE fitment_checks
  ADD CONSTRAINT fitment_checks_order_item_fk
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL;

-- Marketplace availability = stock minus what is currently held (PRD §28).
-- The partner's own ERP stock is never blocked by our reservations.
CREATE VIEW offer_availability AS
SELECT o.id AS offer_id,
       o.stock_quantity,
       COALESCE(r.reserved, 0)                    AS reserved,
       o.stock_quantity - COALESCE(r.reserved, 0) AS available
FROM offers o
LEFT JOIN (
  SELECT offer_id, SUM(quantity)::int AS reserved
  FROM reservations
  WHERE status = 'ACTIVE' AND expires_at > now()
  GROUP BY offer_id
) r ON r.offer_id = o.id;

-- ───────────────────────────── payments ─────────────────────────────

CREATE TABLE payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES orders(id),
  customer_id             uuid NOT NULL REFERENCES users(id),
  provider                text NOT NULL,
  provider_transaction_id text,
  idempotency_key         text NOT NULL UNIQUE,
  amount_minor            bigint NOT NULL,
  commission_minor        bigint NOT NULL,
  currency                char(3) NOT NULL,
  status                  payment_status NOT NULL DEFAULT 'PENDING',
  authorized_at           timestamptz,
  captured_at             timestamptz,
  failed_at               timestamptz,
  failure_code            text,
  raw_response            jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT payment_commission_nonneg CHECK (commission_minor >= 0)
);
CREATE UNIQUE INDEX one_active_payment_per_order ON payments (order_id)
  WHERE status IN ('PENDING','AUTHORIZED','CAPTURED');

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments(id),
  order_id           uuid NOT NULL REFERENCES orders(id),
  amount_minor       bigint NOT NULL,
  currency           char(3) NOT NULL,
  reason             text NOT NULL,
  status             payment_status NOT NULL DEFAULT 'PENDING',
  provider_refund_id text,
  -- A duplicate refund is real money lost, so the key is unique in the
  -- database rather than only in the cache (docs/08 §6.2).
  idempotency_key    text NOT NULL UNIQUE,
  initiated_by       uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  CONSTRAINT refund_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT refund_reason_valid
    CHECK (reason IN ('CUSTOMER_CANCEL','NO_SHOW','STOCK_FAILURE','ADMIN'))
);
CREATE INDEX refunds_by_payment ON refunds (payment_id);

CREATE TABLE settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid NOT NULL REFERENCES partners(id),
  partner_order_id uuid REFERENCES partner_orders(id),
  gross_minor      bigint NOT NULL,
  commission_minor bigint NOT NULL,
  net_minor        bigint NOT NULL,
  currency         char(3) NOT NULL,
  status           settlement_status NOT NULL DEFAULT 'PENDING',
  period_start     date,
  period_end       date,
  paid_at          timestamptz,
  reference        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_math CHECK (net_minor = gross_minor - commission_minor)
);
CREATE INDEX settlements_by_partner ON settlements (partner_id, status);

-- ─────────────── requests (P1 feature, P0 schema — ADR-002) ───────────────

CREATE TABLE request_parts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id  uuid REFERENCES vehicles(id),
  part_name   text NOT NULL,
  description text,
  oem_hint    text,
  photo_urls  text[] NOT NULL DEFAULT '{}',
  status      request_status NOT NULL DEFAULT 'OPEN',
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE request_part_recipients (
  request_id  uuid NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, partner_id)
);

CREATE TABLE partner_offers (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                 uuid NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  partner_id                 uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  can_fulfill                boolean NOT NULL,
  product_name               text,
  brand_id                   uuid REFERENCES brands(id),
  oem                        text,
  price_minor                bigint,
  currency                   char(3),
  stock_quantity             int,
  expected_availability_days int,
  warranty_months            int,
  response_deadline_hours    int,
  note                       text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, partner_id),
  CONSTRAINT partner_offer_price_nonneg CHECK (price_minor IS NULL OR price_minor >= 0)
);

-- ───────────── reviews (P1), notifications, audit ─────────────

CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  partner_id      uuid NOT NULL REFERENCES partners(id),
  product_rating  int,
  seller_rating   int,
  delivery_rating int,
  would_recommend boolean,
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id),
  CONSTRAINT rating_range CHECK (
    COALESCE(product_rating, 1)  BETWEEN 1 AND 5 AND
    COALESCE(seller_rating, 1)   BETWEEN 1 AND 5 AND
    COALESCE(delivery_rating, 1) BETWEEN 1 AND 5)
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  type       text NOT NULL,
  channel    notification_channel NOT NULL,
  -- Parameters, never rendered copy: the recipient may switch language after
  -- the notification was created (PRD §80).
  payload    jsonb NOT NULL DEFAULT '{}',
  sent_at    timestamptz,
  read_at    timestamptz,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id),
  actor_role  user_role,
  partner_id  uuid REFERENCES partners(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_by_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_by_actor ON audit_logs (actor_id, created_at DESC);
COMMENT ON TABLE audit_logs IS
  'Append-only (docs/07 §8). UPDATE and DELETE are revoked from the app role.';

COMMIT;
