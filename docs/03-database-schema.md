# 03 — Database Schema (PostgreSQL 16)

> წყარო: PRD §62–67, §94. კონვენციები: [ADR-005](00-index-and-decisions.md) (ფული = `bigint` minor units).
>
> **სტატუსი:** იმპლემენტირებულია — `db/migrations/0001_initial_schema.sql`.
> ეს დოკუმენტი აღწერს განზრახვას; გატარებადი ჭეშმარიტება migration ფაილია.
> ორს შორის სხვაობისას **migration-ია სწორი**.

---

## 1. კონვენციები

| წესი | მიზეზი |
|------|--------|
| PK = `uuid` (`gen_random_uuid()`) | partner-ებს შორის ID არ ჟონავს; merge-safe |
| ფული = `bigint` minor units + `char(3)` currency | float-ის მრგვალება settlement-ს ანგრევს |
| დრო = `timestamptz`, ყოველთვის UTC | §80 multi-timezone |
| Soft delete = `deleted_at timestamptz` მხოლოდ იქ, სადაც ისტორია საჭიროა | orders არასოდეს იშლება |
| Enum = PostgreSQL native `enum` | DB-ის დონეზე აღსრულებული |
| ყველა ცხრილს აქვს `created_at`, `updated_at` | audit |
| JSONB მხოლოდ **provider raw** და **user answers**-ისთვის | სტრუქტურა ცხრილებშია, არა JSON-ში |

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid, digest
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive e-mail
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- typo tolerance fallback
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraints
```

---

## 2. Enums

```sql
CREATE TYPE user_role AS ENUM (
  'CUSTOMER','PARTNER_USER','PARTNER_ADMIN',
  'PLATFORM_SUPPORT','PLATFORM_ADMIN','SUPER_ADMIN');

CREATE TYPE partner_status   AS ENUM ('PENDING','APPROVED','SUSPENDED','REJECTED');
CREATE TYPE brand_type       AS ENUM ('ORIGINAL_OEM','AFTERMARKET','UNKNOWN');
CREATE TYPE product_condition AS ENUM ('NEW','USED','REFURBISHED');

CREATE TYPE availability_status AS ENUM ('IN_STOCK','AVAILABLE_TO_ORDER','UNAVAILABLE');

-- §16 fitment priority 1..5 — რიგი მნიშვნელოვანია
CREATE TYPE fitment_source AS ENUM (
  'PROVIDER_VIN',        -- 1. ყველაზე სანდო
  'PROVIDER_CONFIG',     -- 2.
  'OEM_MATCH',           -- 3.
  'TECHNICAL_DATA',      -- 4.
  'PARTNER_DECLARED',    -- 5. ყველაზე ნაკლებად სანდო
  'ADMIN_MANUAL');       -- ადმინის override — ყველაფერზე მაღლა

CREATE TYPE fitment_verdict AS ENUM (
  'EXACT','COMPATIBLE','CONDITIONAL','UNCERTAIN','NOT_COMPATIBLE');

CREATE TYPE conflict_status AS ENUM ('OPEN','APPROVED','REJECTED','MAPPED');

CREATE TYPE integration_mode AS ENUM ('API','CSV','MANUAL');
CREATE TYPE sync_status      AS ENUM ('SUCCESS','PARTIAL','FAILED','RUNNING');

CREATE TYPE reservation_status AS ENUM ('ACTIVE','CONSUMED','EXPIRED','RELEASED');

CREATE TYPE order_status AS ENUM (
  'DRAFT','STOCK_RESERVED','AWAITING_PAYMENT','PAID','CONFIRMED',
  'PREPARING','READY_FOR_PICKUP','PICKED_UP','COMPLETED',
  'CANCELLED','FAILED','REFUNDED');

CREATE TYPE payment_status AS ENUM (
  'PENDING','AUTHORIZED','CAPTURED','FAILED','CANCELLED',
  'REFUNDED','PARTIALLY_REFUNDED');

CREATE TYPE settlement_status AS ENUM ('PENDING','PROCESSING','PAID','FAILED');
CREATE TYPE delivery_method   AS ENUM ('PICKUP','COURIER');  -- COURIER = P1
CREATE TYPE payment_terms     AS ENUM ('FULL_PREPAYMENT','PARTIAL_ADVANCE','PAY_ON_ARRIVAL','OTHER');
CREATE TYPE request_status    AS ENUM ('OPEN','ANSWERED','CLOSED','EXPIRED');
CREATE TYPE notification_channel AS ENUM ('IN_APP','SMS','EMAIL','PUSH');
```

---

## 3. Users & Auth

```sql
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE,
  phone          text UNIQUE,
  password_hash  text,
  first_name     text,
  last_name      text,
  locale         text NOT NULL DEFAULT 'ka',
  country        char(2) NOT NULL DEFAULT 'GE',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  suspended_at   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_present CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- ⚠ PRIMARY KEY / UNIQUE შეზღუდვაში გამოსახულება (COALESCE) PostgreSQL-ში
-- დაუშვებელია — ის მხოლოდ unique INDEX-ში მუშაობს.
CREATE TABLE user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       user_role NOT NULL,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id),
  -- partner როლი partner-ის გარეშე unscoped იქნებოდა — ზუსტად ის cross-partner
  -- წვდომა, რისთვისაც docs/07 §5.1 არსებობს.
  CONSTRAINT partner_role_needs_partner CHECK (
    (role IN ('PARTNER_USER','PARTNER_ADMIN')) = (partner_id IS NOT NULL))
);
CREATE UNIQUE INDEX user_roles_unique ON user_roles
  (user_id, role, COALESCE(partner_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,       -- raw token არასოდეს ინახება
  device_id  text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  destination text NOT NULL,             -- phone ან email
  code_hash   text NOT NULL,
  purpose     text NOT NULL,             -- LOGIN | VERIFY | RESET
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_codes (destination, purpose) WHERE consumed_at IS NULL;
```

---

## 4. Vehicles & VIN

**დიზაინის ბირთვი (§11):** ერთი VIN შეიძლება რამდენიმე მომხმარებელს ჰქონდეს. ამიტომ
`vins` და `vehicle_configurations` **გაზიარებულია**, ხოლო `vehicles` არის მომხმარებლის
პირადი ჩანაწერი. ასე ერთი VIN ერთხელ იშიფრება, მაგრამ ხუთი ადამიანის გარაჟში დგას.

```sql
CREATE TABLE vins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin_hash   bytea NOT NULL UNIQUE,      -- sha256(upper(vin)) — ძებნისთვის
  vin_enc    bytea NOT NULL,             -- დაშიფრული VIN (app-level KMS key)
  wmi        char(3) NOT NULL,           -- პირველი 3 სიმბოლო — market routing
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE vins IS
  'VIN არასოდეს ინახება plaintext-ად და არასოდეს ბრუნდება API-ით სრულად (§76).';

CREATE TABLE vehicle_configurations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin_id         uuid REFERENCES vins(id) ON DELETE CASCADE,
  provider       text NOT NULL,          -- 'nhtsa_vpic' | 'mock' | ...
  provider_ref   text,
  make           text NOT NULL,
  model          text NOT NULL,
  model_year     int  NOT NULL,
  generation     text,
  engine         text,
  engine_code    text,
  fuel_type      text,
  transmission   text,
  drive_type     text,
  body_type      text,
  trim           text,
  market         char(2),                -- 'US' | 'EU' | ... — fitment-ისთვის სავალდებულო
  production_from date,
  production_to   date,
  raw            jsonb NOT NULL DEFAULT '{}',   -- provider-ის სრული პასუხი
  decoded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT veh_conf_year_sane CHECK (model_year BETWEEN 1950 AND 2100)
);
CREATE INDEX ON vehicle_configurations (vin_id);
CREATE INDEX ON vehicle_configurations (make, model, model_year);

CREATE TABLE vehicles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin_id          uuid REFERENCES vins(id),
  configuration_id uuid REFERENCES vehicle_configurations(id),
  custom_name     text,                          -- „ოჯახის Toyota“
  -- §63: verified და user-supplied ერთმანეთისგან განცალკევებულია
  verified_data      jsonb NOT NULL DEFAULT '{}',
  user_supplied_data jsonb NOT NULL DEFAULT '{}',
  is_default      boolean NOT NULL DEFAULT false,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (user_id, vin_id)
);
CREATE UNIQUE INDEX one_default_vehicle_per_user
  ON vehicles (user_id) WHERE is_default AND deleted_at IS NULL;
```

> **რატომ ორი jsonb და არა ერთი:** როცა მომხმარებელი პასუხობს „ჩემს მანქანას M Sport
> brakes აქვს“, ეს **ვარაუდია**, არა provider-ის დადასტურება. Fitment Engine ამ ორს
> სხვადასხვა წონით იყენებს (იხ. [05 §5](05-fitment-engine.md)). ერთ ველში შერევა
> ნიშნავს, რომ მოგვიანებით ვეღარ გავარჩევთ რა იცოდა სისტემამ და რა თქვა ადამიანმა.

---

## 5. Partners

```sql
CREATE TABLE partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name       text NOT NULL,
  display_name     text NOT NULL,
  tax_id           text,
  status           partner_status NOT NULL DEFAULT 'PENDING',
  integration_mode integration_mode NOT NULL DEFAULT 'MANUAL',
  country          char(2) NOT NULL DEFAULT 'GE',
  currency         char(3) NOT NULL DEFAULT 'GEL',
  contact_email    citext,
  contact_phone    text,
  stock_reliability numeric(5,4) NOT NULL DEFAULT 1.0,   -- §74, 0..1
  order_success_rate numeric(5,4),
  approved_at      timestamptz,
  suspended_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_reliability_range CHECK (stock_reliability BETWEEN 0 AND 1)
);

CREATE TABLE partner_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name         text NOT NULL,
  address_line text NOT NULL,
  city         text NOT NULL,
  country      char(2) NOT NULL,
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  working_hours jsonb NOT NULL DEFAULT '{}',   -- {"mon":["09:00","19:00"], ...}
  pickup_instructions text,
  phone        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON partner_locations (partner_id) WHERE active;

CREATE TABLE partner_users (
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, user_id)
);
```

---

## 6. Catalog (§19–23)

იერარქია: **Master Part → Product → Offer**.

```sql
CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid REFERENCES categories(id),
  slug       text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- სახელები არსად არ არის hardcoded (§80) — ცალკე ცხრილში, locale-ით
CREATE TABLE category_translations (
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  name        text NOT NULL,
  synonyms    text[] NOT NULL DEFAULT '{}',  -- „აკუმულატორი“, „battery“, „ბატარეა“
  PRIMARY KEY (category_id, locale)
);

CREATE TABLE brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  normalized_name text NOT NULL UNIQUE,   -- lower, punctuation-free
  brand_type brand_type NOT NULL DEFAULT 'AFTERMARKET',
  logo_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- §20: „BMW 228i — Front Brake Pads“ — რა ნაწილია, ბრენდისგან დამოუკიდებლად
CREATE TABLE master_parts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id),
  normalized_name text NOT NULL,
  position    text,                       -- FRONT | REAR | LEFT | RIGHT | NULL
  axle        text,                       -- FRONT_AXLE | REAR_AXLE | NULL
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- §94: duplicate master products აკრძალულია. გამოსახულებიანი უნიკალურობა
-- ცხრილის შეზღუდვად არ იწერება — მხოლოდ ინდექსად.
CREATE UNIQUE INDEX master_parts_unique ON master_parts
  (category_id, normalized_name, COALESCE(position,''), COALESCE(axle,''));
CREATE TABLE master_part_translations (
  master_part_id uuid NOT NULL REFERENCES master_parts(id) ON DELETE CASCADE,
  locale text NOT NULL,
  name   text NOT NULL,
  synonyms text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (master_part_id, locale)
);

CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_part_id uuid NOT NULL REFERENCES master_parts(id),
  brand_id       uuid NOT NULL REFERENCES brands(id),
  name           text NOT NULL,
  description    text,
  condition      product_condition NOT NULL DEFAULT 'NEW',
  warranty_months int,
  specifications jsonb NOT NULL DEFAULT '{}',
  country_of_origin char(2),
  installation_notes text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- MVP-ში იყიდება მხოლოდ NEW (§22); enum მაინც სამივეს იცნობს
  CONSTRAINT product_condition_mvp CHECK (condition = 'NEW' OR active = false)
);
CREATE INDEX ON products (master_part_id);
CREATE INDEX ON products (brand_id);

-- §18, §21: OEM / Part number / SKU / EAN — ერთ პროდუქტს რამდენიმე აქვს
CREATE TABLE product_identifiers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind       text NOT NULL,              -- OEM | MPN | SKU | EAN
  value      text NOT NULL,
  normalized text NOT NULL,              -- upper, dash/space-free — matching-ისთვის
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identifier_kind_valid CHECK (kind IN ('OEM','MPN','SKU','EAN')),
  -- §94: invalid OEM აკრძალულია
  CONSTRAINT identifier_shape CHECK (normalized ~ '^[A-Z0-9]{3,50}$'),
  UNIQUE (kind, normalized, product_id)
);
CREATE INDEX ON product_identifiers (normalized);
CREATE INDEX ON product_identifiers (kind, normalized);

CREATE TABLE product_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

> `product_identifiers.normalized` არის მთელი MVP fitment-ის ხერხემალი
> ([ADR-004](00-index-and-decisions.md)). ამიტომ მას აქვს საკუთარი ინდექსი და
> `CHECK`, და normalization ერთ ადგილას ხდება — `packages/core/src/identifier.ts`.

---

## 7. Fitment (§15–18)

```sql
-- ერთი ჩანაწერი = ერთი მტკიცება „ეს პროდუქტი ერგება ამ კონფიგურაციას“
CREATE TABLE fitments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source       fitment_source NOT NULL,
  partner_id   uuid REFERENCES partners(id),   -- PARTNER_DECLARED-ისთვის
  -- vehicle criteria (NULL = „ნებისმიერი“)
  make         text NOT NULL,
  model        text,
  year_from    int,
  year_to      int,
  generation   text,
  engine_code  text,
  transmission text,
  drive_type   text,
  body_type    text,
  trim         text,
  market       char(2),                        -- კრიტიკული: US ≠ EU
  production_from date,
  production_to   date,
  axle         text,
  position     text,
  -- CONDITIONAL fitment-ის პირობა, მაგ. {"package":"M Sport"}
  conditions   jsonb NOT NULL DEFAULT '{}',
  verdict      fitment_verdict NOT NULL DEFAULT 'COMPATIBLE',
  confidence   numeric(4,3) NOT NULL DEFAULT 0.5,
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fitment_year_range CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to),
  CONSTRAINT fitment_confidence_range CHECK (confidence BETWEEN 0 AND 1)
);
CREATE INDEX ON fitments (product_id) WHERE active;
CREATE INDEX ON fitments (make, model, year_from, year_to) WHERE active;
CREATE INDEX ON fitments (source);

-- §17: partner ამბობს „ერგება“, სანდო provider ამბობს „არ ერგება“
CREATE TABLE fitment_conflicts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  configuration_id uuid REFERENCES vehicle_configurations(id),
  partner_id      uuid REFERENCES partners(id),
  claimed_verdict  fitment_verdict NOT NULL,
  provider_verdict fitment_verdict NOT NULL,
  provider_name   text,
  status          conflict_status NOT NULL DEFAULT 'OPEN',
  resolution_note text,
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON fitment_conflicts (status) WHERE status = 'OPEN';

-- KPI „Fitment Accuracy“ (§61) ამის გარეშე გაზომვადი არ არის
CREATE TABLE fitment_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  configuration_id uuid REFERENCES vehicle_configurations(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  verdict          fitment_verdict NOT NULL,
  winning_source   fitment_source NOT NULL,
  confidence       numeric(4,3) NOT NULL,
  reasons          jsonb NOT NULL DEFAULT '[]',   -- ახსნის ჯაჭვი
  order_item_id    uuid,                          -- შევსდება თუ იყიდეს
  was_correct      boolean,                       -- შევსდება დაბრუნებიდან/საჩივრიდან
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON fitment_checks (created_at);
CREATE INDEX ON fitment_checks (product_id, verdict);
```

---

## 8. Inventory & Offers (§26–33, §64)

```sql
CREATE TABLE offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES products(id),
  location_id         uuid REFERENCES partner_locations(id),
  partner_sku         text,
  base_price_minor    bigint NOT NULL,
  platform_markup_minor bigint NOT NULL DEFAULT 0,
  customer_price_minor  bigint GENERATED ALWAYS AS
                          (base_price_minor + platform_markup_minor) STORED,
  currency            char(3) NOT NULL DEFAULT 'GEL',
  stock_quantity      int NOT NULL DEFAULT 0,
  availability_status availability_status NOT NULL DEFAULT 'UNAVAILABLE',
  expected_availability_days int,
  payment_terms       payment_terms NOT NULL DEFAULT 'FULL_PREPAYMENT',
  warranty_months     int,
  return_policy_id    uuid,
  stock_reliability   numeric(5,4) NOT NULL DEFAULT 1.0,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  is_stale            boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- §94
  CONSTRAINT offer_price_nonneg  CHECK (base_price_minor >= 0 AND platform_markup_minor >= 0),
  CONSTRAINT offer_stock_nonneg  CHECK (stock_quantity >= 0),
  CONSTRAINT offer_currency_iso  CHECK (currency ~ '^[A-Z]{3}
CREATE INDEX ON offers (product_id) WHERE active;
CREATE INDEX ON offers (partner_id) WHERE active;
CREATE INDEX ON offers (availability_status) WHERE active;

-- §33: markup engine — category-specific, partner-specific, ან ორივე
CREATE TABLE price_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid REFERENCES partners(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  markup_percent numeric(6,3),
  markup_fixed_minor bigint,
  currency    char(3),
  priority    int NOT NULL DEFAULT 0,      -- უფრო სპეციფიკური = მაღალი
  active      boolean NOT NULL DEFAULT true,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_rule_has_value
    CHECK (markup_percent IS NOT NULL OR markup_fixed_minor IS NOT NULL),
  CONSTRAINT price_rule_scope
    CHECK (partner_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE TABLE inventory_syncs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  mode         integration_mode NOT NULL,
  status       sync_status NOT NULL,
  rows_total   int NOT NULL DEFAULT 0,
  rows_ok      int NOT NULL DEFAULT 0,
  rows_failed  int NOT NULL DEFAULT 0,
  errors       jsonb NOT NULL DEFAULT '[]',  -- [{row, column, code, message}]
  file_url     text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX ON inventory_syncs (partner_id, started_at DESC);

-- KPI „Inventory Accuracy“ (§61)
CREATE TABLE inventory_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  believed_quantity int NOT NULL,
  actual_quantity   int,
  matched     boolean,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  context     text NOT NULL             -- 'PRE_RESERVE' | 'PRE_PAYMENT' | 'SYNC'
);
```

### 8.1 ხელმისაწვდომი რაოდენობა (§28)

```sql
CREATE VIEW offer_availability AS
SELECT o.id AS offer_id,
       o.stock_quantity,
       COALESCE(r.reserved, 0)                    AS reserved,
       o.stock_quantity - COALESCE(r.reserved, 0) AS available
FROM offers o
LEFT JOIN (
  SELECT offer_id, SUM(quantity) AS reserved
  FROM reservations
  WHERE status = 'ACTIVE' AND expires_at > now()
  GROUP BY offer_id
) r ON r.offer_id = o.id;
```
> §28-ის მაგალითი: stock = 5, marketplace reservation = 1 → available = 4.
> პარტნიორის ERP-ის მარაგი **არ იბლოკება** — reservation მხოლოდ ჩვენს მხარეს მოქმედებს.

---

## 9. Cart, Reservation, Orders (§40–43, §65–66)

```sql
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

CREATE TABLE reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    uuid,
  quantity    int NOT NULL,
  status      reservation_status NOT NULL DEFAULT 'ACTIVE',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,       -- reserved_at + 15 წუთი
  released_at timestamptz,
  CONSTRAINT reservation_qty CHECK (quantity > 0)
);
CREATE INDEX active_reservations ON reservations (offer_id)
  WHERE status = 'ACTIVE';
CREATE INDEX expiring_reservations ON reservations (expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text NOT NULL UNIQUE,     -- „AP-10234“ — მომხმარებლისთვის
  user_id             uuid NOT NULL REFERENCES users(id),
  vehicle_id          uuid REFERENCES vehicles(id),
  status              order_status NOT NULL DEFAULT 'DRAFT',
  delivery_method     delivery_method NOT NULL DEFAULT 'PICKUP',
  subtotal_minor      bigint NOT NULL,          -- Σ base_price × qty
  markup_minor        bigint NOT NULL,          -- Σ platform_markup × qty
  total_minor         bigint NOT NULL,          -- subtotal + markup
  currency            char(3) NOT NULL,
  payment_status      payment_status NOT NULL DEFAULT 'PENDING',
  cancellation_deadline timestamptz,
  ready_for_pickup_at timestamptz,
  pickup_deadline     timestamptz,              -- ready_for_pickup_at + 24სთ (§52)
  picked_up_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_total_consistent CHECK (total_minor = subtotal_minor + markup_minor),
  CONSTRAINT order_amounts_nonneg CHECK (subtotal_minor >= 0 AND markup_minor >= 0)
);
CREATE INDEX ON orders (user_id, created_at DESC);
CREATE INDEX ON orders (status);
CREATE INDEX pickup_deadline_watch ON orders (pickup_deadline)
  WHERE status = 'READY_FOR_PICKUP';

-- §41: multi-vendor არქიტექტურა დღიდან, თუნდაც MVP-ში ყოველთვის 1 იყოს
CREATE TABLE partner_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES partners(id),
  location_id     uuid REFERENCES partner_locations(id),
  status          order_status NOT NULL DEFAULT 'CONFIRMED',
  subtotal_minor  bigint NOT NULL,
  markup_minor    bigint NOT NULL,
  total_minor     bigint NOT NULL,
  currency        char(3) NOT NULL,
  pickup_code     text,                    -- QR payload (§49)
  pickup_code_hash bytea,
  ready_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON partner_orders (partner_id, status);
-- MVP-ის შეზღუდვა (§40): ერთ checkout-ში ერთი პარტნიორი.
-- P1-ზე ეს ინდექსი უბრალოდ იშლება — ცხრილი არ იცვლება.
CREATE UNIQUE INDEX mvp_single_partner_per_order ON partner_orders (order_id);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_order_id  uuid NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
  offer_id          uuid NOT NULL REFERENCES offers(id),
  product_id        uuid NOT NULL REFERENCES products(id),
  vehicle_id        uuid REFERENCES vehicles(id),
  quantity          int NOT NULL,
  -- ფასი ფიქსირდება შეკვეთის მომენტში და აღარ იცვლება
  base_price_minor  bigint NOT NULL,
  markup_minor      bigint NOT NULL,
  line_total_minor  bigint NOT NULL,
  currency          char(3) NOT NULL,
  -- ყიდვის მომენტის fitment — მტკიცებულება დავის შემთხვევაში
  fitment_verdict   fitment_verdict NOT NULL,
  fitment_check_id  uuid REFERENCES fitment_checks(id),
  product_snapshot  jsonb NOT NULL,        -- name, brand, OEM — მაშინდელი
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_item_qty CHECK (quantity > 0)
);
```

> `product_snapshot` და ფიქსირებული ფასები განზრახ დუბლირებაა. პარტნიორმა ხვალ შეიძლება
> პროდუქტის სახელი ან ფასი შეცვალოს; შეკვეთის ისტორია მაშინდელს უნდა აჩვენებდეს.

---

## 10. Payments (§44, §67)

```sql
CREATE TABLE payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES orders(id),
  customer_id           uuid NOT NULL REFERENCES users(id),
  provider              text NOT NULL,           -- 'mock' | 'bog' | 'tbc' | ...
  provider_transaction_id text,
  idempotency_key       text NOT NULL UNIQUE,
  amount_minor          bigint NOT NULL,         -- = orders.total_minor
  commission_minor      bigint NOT NULL,         -- = orders.markup_minor
  currency              char(3) NOT NULL,
  status                payment_status NOT NULL DEFAULT 'PENDING',
  authorized_at         timestamptz,
  captured_at           timestamptz,
  failed_at             timestamptz,
  failure_code          text,
  raw_response          jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_amount_positive CHECK (amount_minor > 0)
);
CREATE UNIQUE INDEX one_active_payment_per_order ON payments (order_id)
  WHERE status IN ('PENDING','AUTHORIZED','CAPTURED');

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id),
  order_id     uuid NOT NULL REFERENCES orders(id),
  amount_minor bigint NOT NULL,
  currency     char(3) NOT NULL,
  reason       text NOT NULL,   -- CUSTOMER_CANCEL | NO_SHOW | STOCK_FAILURE | ADMIN
  status       payment_status NOT NULL DEFAULT 'PENDING',
  provider_refund_id text,
  idempotency_key text NOT NULL UNIQUE,
  initiated_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT refund_amount_positive CHECK (amount_minor > 0)
);

CREATE TABLE settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid NOT NULL REFERENCES partners(id),
  partner_order_id uuid REFERENCES partner_orders(id),
  gross_minor      bigint NOT NULL,   -- customer-ის გადახდილი
  commission_minor bigint NOT NULL,   -- პლატფორმის markup
  net_minor        bigint NOT NULL,   -- პარტნიორზე გასარიცხი
  currency         char(3) NOT NULL,
  status           settlement_status NOT NULL DEFAULT 'PENDING',
  period_start     date,
  period_end       date,
  paid_at          timestamptz,
  reference        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_math CHECK (net_minor = gross_minor - commission_minor)
);
CREATE INDEX ON settlements (partner_id, status);
```

---

## 11. Requests (P1 — schema P0, [ADR-002](00-index-and-decisions.md))

```sql
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
  request_id uuid NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, partner_id)
);

CREATE TABLE partner_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  can_fulfill     boolean NOT NULL,
  product_name    text,
  brand_id        uuid REFERENCES brands(id),
  oem             text,
  price_minor     bigint,
  currency        char(3),
  stock_quantity  int,
  expected_availability_days int,
  warranty_months int,
  response_deadline_hours int,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, partner_id)
);
```

---

## 12. Reviews (P1), Notifications, Audit

```sql
CREATE TABLE reviews (                              -- P1
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  product_rating int, seller_rating int, delivery_rating int,
  would_recommend boolean,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id),
  CONSTRAINT rating_range CHECK (
    COALESCE(product_rating,1)  BETWEEN 1 AND 5 AND
    COALESCE(seller_rating,1)   BETWEEN 1 AND 5 AND
    COALESCE(delivery_rating,1) BETWEEN 1 AND 5)
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  type       text NOT NULL,          -- ORDER_CONFIRMED | READY_FOR_PICKUP | ...
  channel    notification_channel NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',   -- i18n placeholders, არა მზა ტექსტი
  sent_at    timestamptz,
  read_at    timestamptz,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE audit_logs (                          -- §79
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id),
  actor_role  user_role,
  partner_id  uuid REFERENCES partners(id),
  action      text NOT NULL,        -- PRICE_CHANGE | STOCK_CHANGE | FITMENT_CHANGE | ...
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX ON audit_logs (actor_id, created_at DESC);
```

**`notifications.payload` ინახავს პარამეტრებს, არა მზა ტექსტს.** მიზეზი §80 —
მომხმარებელმა შეიძლება ენა შეცვალოს notification-ის გაგზავნის შემდეგ, და in-app სია
ახალ ენაზე უნდა გამოჩნდეს.

---

## 13. Invariants

DB constraint-ებით ვერ აღსრულებადი წესები — აღსრულდება service-ის ტრანზაქციაში და
თითოეულს აქვს integration ტესტი:

| # | Invariant | სად |
|---|-----------|-----|
| I1 | `SUM(active reservations) <= offers.stock_quantity` | `ReservationService`, `SELECT … FOR UPDATE` + Redis lock |
| I2 | `orders.total = Σ order_items.line_total` | `OrderService.create` |
| I3 | `payments.amount = orders.total` | `PaymentService.initiate` |
| I4 | `Σ refunds.amount <= payments.amount` | `RefundService` |
| I5 | `order_items.fitment_verdict ∈ (EXACT, COMPATIBLE, CONDITIONAL)` | `CartService.addItem` — R1 |
| I6 | `READY_FOR_PICKUP` → `pickup_deadline = ready_for_pickup_at + 24h` | `OrderLifecycle` |
| I7 | ყველა offer-ის წაკითხვა partner-scoped-ია არა-ადმინისთვის | `OfferRepository` guard — §3 |
| I8 | `settlements.net = gross - commission` | DB CHECK + reconciliation job |

---

## 14. Seed data (Step 2)

`db/seeds/` უნდა შეიცავდეს იმდენს, რომ **Step 3–11 mock-ზე სრულად იმუშაოს**:

- 18 კატეგორია (§14) ka/en თარგმანებით და სინონიმებით
- §5-ის 15 ბრენდი + **Opel** (PRD-ში ცალკე ხაზგასმული)
- ~50 master part ყველაზე გავრცელებულ კატეგორიებში
- ~200 product OEM ნომრებით
- 3 partner, თითოს 2 location თბილისში, სხვადასხვა `stock_reliability`-თ
- ~400 offer სხვადასხვა ფასით/მარაგით — price comparison-ის სატესტოდ
- 10 ცნობილი VIN → `MockFitmentProvider`-ის კონფიგურაციები (BMW 228i F22 შედის, რადგან
  ის PRD-ის სახელმძღვანელო მაგალითია)
- fitment ჩანაწერები, რომელთაგან **ნაწილი განზრახ CONFLICT-ია** — §17-ის flow ტესტდება
)
);
-- location_id nullable-ია, ხოლო SQL-ში NULL != NULL — ჩვეულებრივი UNIQUE
-- დუბლიკატებს გაატარებდა. COALESCE ამას ხურავს.
CREATE UNIQUE INDEX offers_partner_product_location ON offers
  (partner_id, product_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX ON offers (product_id) WHERE active;
CREATE INDEX ON offers (partner_id) WHERE active;
CREATE INDEX ON offers (availability_status) WHERE active;

-- §33: markup engine — category-specific, partner-specific, ან ორივე
CREATE TABLE price_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid REFERENCES partners(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  markup_percent numeric(6,3),
  markup_fixed_minor bigint,
  currency    char(3),
  priority    int NOT NULL DEFAULT 0,      -- უფრო სპეციფიკური = მაღალი
  active      boolean NOT NULL DEFAULT true,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_rule_has_value
    CHECK (markup_percent IS NOT NULL OR markup_fixed_minor IS NOT NULL),
  CONSTRAINT price_rule_scope
    CHECK (partner_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE TABLE inventory_syncs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  mode         integration_mode NOT NULL,
  status       sync_status NOT NULL,
  rows_total   int NOT NULL DEFAULT 0,
  rows_ok      int NOT NULL DEFAULT 0,
  rows_failed  int NOT NULL DEFAULT 0,
  errors       jsonb NOT NULL DEFAULT '[]',  -- [{row, column, code, message}]
  file_url     text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX ON inventory_syncs (partner_id, started_at DESC);

-- KPI „Inventory Accuracy“ (§61)
CREATE TABLE inventory_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  believed_quantity int NOT NULL,
  actual_quantity   int,
  matched     boolean,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  context     text NOT NULL             -- 'PRE_RESERVE' | 'PRE_PAYMENT' | 'SYNC'
);
```

### 8.1 ხელმისაწვდომი რაოდენობა (§28)

```sql
CREATE VIEW offer_availability AS
SELECT o.id AS offer_id,
       o.stock_quantity,
       COALESCE(r.reserved, 0)                    AS reserved,
       o.stock_quantity - COALESCE(r.reserved, 0) AS available
FROM offers o
LEFT JOIN (
  SELECT offer_id, SUM(quantity) AS reserved
  FROM reservations
  WHERE status = 'ACTIVE' AND expires_at > now()
  GROUP BY offer_id
) r ON r.offer_id = o.id;
```
> §28-ის მაგალითი: stock = 5, marketplace reservation = 1 → available = 4.
> პარტნიორის ERP-ის მარაგი **არ იბლოკება** — reservation მხოლოდ ჩვენს მხარეს მოქმედებს.

---

## 9. Cart, Reservation, Orders (§40–43, §65–66)

```sql
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

CREATE TABLE reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    uuid,
  quantity    int NOT NULL,
  status      reservation_status NOT NULL DEFAULT 'ACTIVE',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,       -- reserved_at + 15 წუთი
  released_at timestamptz,
  CONSTRAINT reservation_qty CHECK (quantity > 0)
);
CREATE INDEX active_reservations ON reservations (offer_id)
  WHERE status = 'ACTIVE';
CREATE INDEX expiring_reservations ON reservations (expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text NOT NULL UNIQUE,     -- „AP-10234“ — მომხმარებლისთვის
  user_id             uuid NOT NULL REFERENCES users(id),
  vehicle_id          uuid REFERENCES vehicles(id),
  status              order_status NOT NULL DEFAULT 'DRAFT',
  delivery_method     delivery_method NOT NULL DEFAULT 'PICKUP',
  subtotal_minor      bigint NOT NULL,          -- Σ base_price × qty
  markup_minor        bigint NOT NULL,          -- Σ platform_markup × qty
  total_minor         bigint NOT NULL,          -- subtotal + markup
  currency            char(3) NOT NULL,
  payment_status      payment_status NOT NULL DEFAULT 'PENDING',
  cancellation_deadline timestamptz,
  ready_for_pickup_at timestamptz,
  pickup_deadline     timestamptz,              -- ready_for_pickup_at + 24სთ (§52)
  picked_up_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_total_consistent CHECK (total_minor = subtotal_minor + markup_minor),
  CONSTRAINT order_amounts_nonneg CHECK (subtotal_minor >= 0 AND markup_minor >= 0)
);
CREATE INDEX ON orders (user_id, created_at DESC);
CREATE INDEX ON orders (status);
CREATE INDEX pickup_deadline_watch ON orders (pickup_deadline)
  WHERE status = 'READY_FOR_PICKUP';

-- §41: multi-vendor არქიტექტურა დღიდან, თუნდაც MVP-ში ყოველთვის 1 იყოს
CREATE TABLE partner_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES partners(id),
  location_id     uuid REFERENCES partner_locations(id),
  status          order_status NOT NULL DEFAULT 'CONFIRMED',
  subtotal_minor  bigint NOT NULL,
  markup_minor    bigint NOT NULL,
  total_minor     bigint NOT NULL,
  currency        char(3) NOT NULL,
  pickup_code     text,                    -- QR payload (§49)
  pickup_code_hash bytea,
  ready_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON partner_orders (partner_id, status);
-- MVP-ის შეზღუდვა (§40): ერთ checkout-ში ერთი პარტნიორი.
-- P1-ზე ეს ინდექსი უბრალოდ იშლება — ცხრილი არ იცვლება.
CREATE UNIQUE INDEX mvp_single_partner_per_order ON partner_orders (order_id);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  partner_order_id  uuid NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
  offer_id          uuid NOT NULL REFERENCES offers(id),
  product_id        uuid NOT NULL REFERENCES products(id),
  vehicle_id        uuid REFERENCES vehicles(id),
  quantity          int NOT NULL,
  -- ფასი ფიქსირდება შეკვეთის მომენტში და აღარ იცვლება
  base_price_minor  bigint NOT NULL,
  markup_minor      bigint NOT NULL,
  line_total_minor  bigint NOT NULL,
  currency          char(3) NOT NULL,
  -- ყიდვის მომენტის fitment — მტკიცებულება დავის შემთხვევაში
  fitment_verdict   fitment_verdict NOT NULL,
  fitment_check_id  uuid REFERENCES fitment_checks(id),
  product_snapshot  jsonb NOT NULL,        -- name, brand, OEM — მაშინდელი
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_item_qty CHECK (quantity > 0)
);
```

> `product_snapshot` და ფიქსირებული ფასები განზრახ დუბლირებაა. პარტნიორმა ხვალ შეიძლება
> პროდუქტის სახელი ან ფასი შეცვალოს; შეკვეთის ისტორია მაშინდელს უნდა აჩვენებდეს.

---

## 10. Payments (§44, §67)

```sql
CREATE TABLE payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES orders(id),
  customer_id           uuid NOT NULL REFERENCES users(id),
  provider              text NOT NULL,           -- 'mock' | 'bog' | 'tbc' | ...
  provider_transaction_id text,
  idempotency_key       text NOT NULL UNIQUE,
  amount_minor          bigint NOT NULL,         -- = orders.total_minor
  commission_minor      bigint NOT NULL,         -- = orders.markup_minor
  currency              char(3) NOT NULL,
  status                payment_status NOT NULL DEFAULT 'PENDING',
  authorized_at         timestamptz,
  captured_at           timestamptz,
  failed_at             timestamptz,
  failure_code          text,
  raw_response          jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_amount_positive CHECK (amount_minor > 0)
);
CREATE UNIQUE INDEX one_active_payment_per_order ON payments (order_id)
  WHERE status IN ('PENDING','AUTHORIZED','CAPTURED');

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id),
  order_id     uuid NOT NULL REFERENCES orders(id),
  amount_minor bigint NOT NULL,
  currency     char(3) NOT NULL,
  reason       text NOT NULL,   -- CUSTOMER_CANCEL | NO_SHOW | STOCK_FAILURE | ADMIN
  status       payment_status NOT NULL DEFAULT 'PENDING',
  provider_refund_id text,
  idempotency_key text NOT NULL UNIQUE,
  initiated_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT refund_amount_positive CHECK (amount_minor > 0)
);

CREATE TABLE settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid NOT NULL REFERENCES partners(id),
  partner_order_id uuid REFERENCES partner_orders(id),
  gross_minor      bigint NOT NULL,   -- customer-ის გადახდილი
  commission_minor bigint NOT NULL,   -- პლატფორმის markup
  net_minor        bigint NOT NULL,   -- პარტნიორზე გასარიცხი
  currency         char(3) NOT NULL,
  status           settlement_status NOT NULL DEFAULT 'PENDING',
  period_start     date,
  period_end       date,
  paid_at          timestamptz,
  reference        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_math CHECK (net_minor = gross_minor - commission_minor)
);
CREATE INDEX ON settlements (partner_id, status);
```

---

## 11. Requests (P1 — schema P0, [ADR-002](00-index-and-decisions.md))

```sql
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
  request_id uuid NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, partner_id)
);

CREATE TABLE partner_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES request_parts(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  can_fulfill     boolean NOT NULL,
  product_name    text,
  brand_id        uuid REFERENCES brands(id),
  oem             text,
  price_minor     bigint,
  currency        char(3),
  stock_quantity  int,
  expected_availability_days int,
  warranty_months int,
  response_deadline_hours int,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, partner_id)
);
```

---

## 12. Reviews (P1), Notifications, Audit

```sql
CREATE TABLE reviews (                              -- P1
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  product_rating int, seller_rating int, delivery_rating int,
  would_recommend boolean,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id),
  CONSTRAINT rating_range CHECK (
    COALESCE(product_rating,1)  BETWEEN 1 AND 5 AND
    COALESCE(seller_rating,1)   BETWEEN 1 AND 5 AND
    COALESCE(delivery_rating,1) BETWEEN 1 AND 5)
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  type       text NOT NULL,          -- ORDER_CONFIRMED | READY_FOR_PICKUP | ...
  channel    notification_channel NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',   -- i18n placeholders, არა მზა ტექსტი
  sent_at    timestamptz,
  read_at    timestamptz,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE audit_logs (                          -- §79
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id),
  actor_role  user_role,
  partner_id  uuid REFERENCES partners(id),
  action      text NOT NULL,        -- PRICE_CHANGE | STOCK_CHANGE | FITMENT_CHANGE | ...
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX ON audit_logs (actor_id, created_at DESC);
```

**`notifications.payload` ინახავს პარამეტრებს, არა მზა ტექსტს.** მიზეზი §80 —
მომხმარებელმა შეიძლება ენა შეცვალოს notification-ის გაგზავნის შემდეგ, და in-app სია
ახალ ენაზე უნდა გამოჩნდეს.

---

## 13. Invariants

DB constraint-ებით ვერ აღსრულებადი წესები — აღსრულდება service-ის ტრანზაქციაში და
თითოეულს აქვს integration ტესტი:

| # | Invariant | სად |
|---|-----------|-----|
| I1 | `SUM(active reservations) <= offers.stock_quantity` | `ReservationService`, `SELECT … FOR UPDATE` + Redis lock |
| I2 | `orders.total = Σ order_items.line_total` | `OrderService.create` |
| I3 | `payments.amount = orders.total` | `PaymentService.initiate` |
| I4 | `Σ refunds.amount <= payments.amount` | `RefundService` |
| I5 | `order_items.fitment_verdict ∈ (EXACT, COMPATIBLE, CONDITIONAL)` | `CartService.addItem` — R1 |
| I6 | `READY_FOR_PICKUP` → `pickup_deadline = ready_for_pickup_at + 24h` | `OrderLifecycle` |
| I7 | ყველა offer-ის წაკითხვა partner-scoped-ია არა-ადმინისთვის | `OfferRepository` guard — §3 |
| I8 | `settlements.net = gross - commission` | DB CHECK + reconciliation job |

---

## 14. Seed data (Step 2)

`db/seeds/` უნდა შეიცავდეს იმდენს, რომ **Step 3–11 mock-ზე სრულად იმუშაოს**:

- 18 კატეგორია (§14) ka/en თარგმანებით და სინონიმებით
- §5-ის 15 ბრენდი + **Opel** (PRD-ში ცალკე ხაზგასმული)
- ~50 master part ყველაზე გავრცელებულ კატეგორიებში
- ~200 product OEM ნომრებით
- 3 partner, თითოს 2 location თბილისში, სხვადასხვა `stock_reliability`-თ
- ~400 offer სხვადასხვა ფასით/მარაგით — price comparison-ის სატესტოდ
- 10 ცნობილი VIN → `MockFitmentProvider`-ის კონფიგურაციები (BMW 228i F22 შედის, რადგან
  ის PRD-ის სახელმძღვანელო მაგალითია)
- fitment ჩანაწერები, რომელთაგან **ნაწილი განზრახ CONFLICT-ია** — §17-ის flow ტესტდება
