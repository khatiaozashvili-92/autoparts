# 02 — System Architecture

> წყარო: PRD §68–75, §96, §100–102. სტეკი დადასტურებულია §69-ით.

---

## 1. მაღალი დონის სურათი

```
   ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
   │  Web (Next)  │   │ Mobile (RN)      │   │ Partner /    │
   │              │   │ iOS + Android    │   │ Admin (Next) │
   └──────┬───────┘   └────────┬─────────┘   └──────┬───────┘
          └────────────────────┼────────────────────┘
                               ↓  HTTPS / JSON / JWT
                    ┌──────────────────────┐
                    │   API Gateway        │  rate limit · authn · tracing
                    │   (NestJS)           │
                    └──────────┬───────────┘
                               ↓
   ┌───────────────────────────────────────────────────────┐
   │                  Application Modules                  │
   │  Auth · Users · Vehicles · VIN · Fitment · Catalog    │
   │  Products · Search · Inventory · Partners · Offers    │
   │  Cart · Orders · Payments · Refunds · Requests        │
   │  Notifications · Reviews · Admin · Analytics          │
   └───┬────────────┬────────────┬─────────────┬───────────┘
       ↓            ↓            ↓             ↓
 ┌───────────────────────────────┐ ┌─────────────────┐
 │         PostgreSQL            │ │ S3-compatible   │
 │  SoR · search · locks · jobs  │ │ object storage  │
 └───────────────────────────────┘ └─────────────────┘
     Redis და OpenSearch გათვალისწინებულია, მაგრამ MVP მათ არ იყენებს
     (ADR-010, ADR-012) — infra/docker-compose.yml მაინც ინახავს მათ.
       ↑
 ┌─────┴──────────────────────────────────────────────┐
 │        Provider Abstraction Layer                  │
 ├────────────────────────┬───────────────────────────┤
 │ FitmentProvider        │ PartnerIntegrationLayer   │
 │  ├ MockProvider        │  ├ ApiAdapter             │
 │  ├ NhtsaVpicProvider   │  ├ CsvAdapter             │
 │  └ CommercialProvider  │  └ ManualAdapter          │
 ├────────────────────────┼───────────────────────────┤
 │ PaymentProvider        │ NotificationProvider      │
 │  ├ MockProvider        │  ├ Sms / Email / Push      │
 │  └ AcquirerAdapter     │  └ InApp                  │
 └────────────────────────┴───────────────────────────┘
```

**არქიტექტურის ერთადერთი ურღვევი წესი (§71, §102):**
external provider-ზე დამოკიდებული კოდი **არასოდეს** ჩნდება business logic-ში.
ყოველი გარე სამყარო შემოდის ინტერფეისით. ეს არ არის სტილის საკითხი — ეს არის ის,
რაც `MockProvider`-ით development-ს შესაძლებელს ხდის კომერციული ხელშეკრულების გარეშე (§101).

---

## 2. Monorepo სტრუქტურა

```
autoparts/
├── apps/
│   ├── api/                 NestJS backend
│   ├── web/                 Next.js — customer + /partner + /admin (ADR-013)
│   └── mobile/              React Native (Expo)
├── packages/
│   ├── core/                domain types, enums, Money, გაზიარებული ლოგიკა
│   ├── api-client/          typed client (OpenAPI-დან გენერირებული)
│   ├── fitment/             Fitment Engine — წმინდა ლოგიკა, DB-ის გარეშე
│   ├── providers/           FitmentProvider / PaymentProvider adapters
│   ├── i18n/                translation keys — ka, en
│   └── ui/                  გაზიარებული დიზაინის ტოკენები/კომპონენტები
├── db/
│   ├── migrations/
│   └── seeds/
├── docs/                    ეს დოკუმენტები
└── infra/                   docker-compose, IaC, CI
```

**რატომ monorepo:** `packages/core`-ის ერთი ცვლილება (მაგ. `OrderStatus`-ში ახალი
მდგომარეობა) ერთდროულად უნდა გავრცელდეს backend-ზე, ვებზე და მობილურზე. ცალკე repo-ებში
ეს სამ PR-ად და სამ deploy-ად იქცევა, რომელთაგან ერთ-ერთი დაგვავიწყდება.

**Package manager:** pnpm workspaces. **Build:** Turborepo.

### 2.1 `apps/api` მოდულები (§68)

```
src/
├── common/       guards · interceptors · filters · pagination · Money
├── modules/
│   ├── auth/           users/ roles/ tokens/ otp/
│   ├── vehicles/       vin/ garage/ configurations/
│   ├── fitment/        engine/ rules/ conflicts/
│   ├── catalog/        brands/ categories/ master-parts/ products/
│   ├── search/         indexer/ query/ synonyms/
│   ├── inventory/      sync/ reliability/ validation/
│   ├── partners/       profile/ locations/ users/ integration/
│   ├── offers/         pricing/ sorting/ ranking/
│   ├── cart/           cart/ reservations/
│   ├── orders/         orders/ lifecycle/ pickup/
│   ├── payments/       payments/ refunds/ settlements/ commission/
│   ├── requests/       request-part/ partner-offers/     (P1, schema P0)
│   ├── notifications/  channels/ templates/ dispatch/
│   ├── reviews/                                          (P1)
│   ├── admin/
│   └── analytics/
└── providers/    FitmentProvider · PaymentProvider · PartnerIntegration
```

**მოდულების წესი:** მოდული სხვა მოდულის **repository**-ს პირდაპირ არ ეხება; მხოლოდ მის
exported service-ს. ეს ინარჩუნებს იმის შესაძლებლობას, რომ `search` ან `inventory`
მოგვიანებით ცალკე სერვისად გამოვიდეს, თუ დატვირთვა მოითხოვს.

---

## 3. ტექნოლოგიები (§69)

| ფენა | არჩევანი | შენიშვნა |
|------|----------|----------|
| Web | Next.js (App Router) + React + TypeScript | SSR პროდუქტის გვერდებზე — SEO |
| Mobile | React Native + Expo + TypeScript | ერთი ენა backend-თან |
| Backend | **NestJS + TypeScript** | modular architecture — §69-ის რეკომენდაცია |
| DB წვდომა | `pg` + raw SQL migration-ები | schema დგას generated columns/CHECK-ებზე, რასაც ORM-ის schema ენა ვერ გამოხატავს — [ADR-008](00-index-and-decisions.md) |
| Database | PostgreSQL 16 | System of Record |
| Search | **PostgreSQL** (`tsvector` + `pg_trgm`) | ka/en, სინონიმები, typo tolerance — [ADR-010](00-index-and-decisions.md). OpenSearch რჩება ინტერფეისის უკან |
| Lock | **PostgreSQL advisory locks** | reservation-ის სერიალიზაცია — [ADR-012](00-index-and-decisions.md) |
| Jobs | **`setInterval` + advisory lock** | reservation/no-show sweep; ორივე იდემპოტენტურია და სისწორე მათზე არ დგას |
| Storage | S3-compatible | პროდუქტის სურათები, CSV ატვირთვები |
| Observability | OpenTelemetry + structured JSON logs | §95 |

**Flutter-ის შესახებ:** §69 მას ალტერნატივად უშვებს. აქ არჩეულია React Native, რადგან
`packages/core`, `packages/api-client` და `packages/fitment` მაშინ **ორივეს** ემსახურება.
Flutter-ის შემთხვევაში იგივე ლოგიკა Dart-ზე ხელახლა იწერება — ანუ Fitment Engine ორ ენაზე.
ეს პირდაპირ ეწინააღმდეგება §1-ის პრიორიტეტს (Fitment Accuracy).

---

## 4. Provider Abstraction (§102)

```ts
// packages/providers/src/fitment/fitment-provider.interface.ts
export interface FitmentProvider {
  readonly name: string;

  decodeVin(vin: string): Promise<VinDecodeResult>;
  getVehicleConfiguration(vehicleRef: VehicleRef): Promise<VehicleConfiguration>;
  getCompatibleParts(config: VehicleConfiguration, q: PartQuery): Promise<PartRef[]>;
  getPartDetails(partRef: PartRef): Promise<PartDetails>;
  validateFitment(config: VehicleConfiguration, partRef: PartRef): Promise<FitmentVerdict>;

  /** provider-ის შესაძლებლობები — ძრავა იყენებს verdict-ის ასაწონად */
  capabilities(): ProviderCapabilities;
}

export interface ProviderCapabilities {
  markets: Market[];          // ['US'] vPIC-ისთვის
  hasEngineCode: boolean;
  hasTrim: boolean;
  hasProductionDate: boolean;
  hasPartLinkage: boolean;    // false vPIC-ისთვის — ეს კრიტიკულია
  costPerCall: Money | null;
}
```

იმპლემენტაციები: `MockFitmentProvider`, `NhtsaVpicProvider`, `CommercialProvider`
([ADR-003](00-index-and-decisions.md)).

### 4.1 Provider chain და fallback

```
decodeVin(vin)
   ↓
[1] ლოკალური ქეში — vehicle_configurations (VIN hash-ით)
   ↓ miss
[2] Primary provider (config-ით არჩეული)
   ↓ miss / timeout / market mismatch
[3] Fallback provider
   ↓ miss
[4] Manual entry flow — მომხმარებელი თავად ირჩევს make/model/year/engine
```

**[1] არ არის ოპტიმიზაცია — ის არის §96-ის მოთხოვნა:** decoded configuration ჩვენს
ბაზაშია, ამიტომ provider-ის გათიშვა Garage-ს არ კლავს.

`capabilities().markets`-ის შემოწმება **ვიდრე** provider გამოიძახება: US VIN (WMI-ის
1/4/5/7 პრეფიქსი) → vPIC; სხვა → commercial. ეს ზოგავს ფულს და დროს.

---

## 5. მონაცემთა ნაკადები

### 5.1 Search (§72)

```
Query (ka/en/OEM/SKU) + vehicle_id + filters
   ↓
Query normalization — transliteration, synonyms, typo tolerance
   ↓
search_documents — candidate products (tsvector / trigram)
   ↓
Fitment Engine — verdict თითოეულ კანდიდატზე
   ↓
გაფილტვრა: მხოლოდ EXACT | COMPATIBLE | CONDITIONAL
   ↓
Offers join — inventory + pricing + markup
   ↓
Sorting (Recommended | Cheapest | Nearest | Best Rated | Fastest)
   ↓
Response
```

**რატომ არის fitment pre-filter ინდექსში და ისევ ძრავაში:** ინდექსი აჩქარებს
(მილიონიდან ასამდე), ძრავა კი წყვეტს. ინდექსს **არასოდეს** აქვს ბოლო სიტყვა —
ეს R1-ის დარღვევა იქნებოდა, რადგან ინდექსი შეიძლება მოძველებული იყოს.

### 5.2 Inventory (§26)

```
Partner inventory
   ↓ periodic sync (API) | CSV upload | manual edit
Integration Layer — normalization
   ↓
inventory + offers (ჩვენი DB)
   ↓
search_documents (fast search)
   ↓
... მომხმარებელი ირჩევს ...
   ↓
Real-time final stock check  ← R2
   ↓
Reserve → Pay
```

### 5.3 Reservation (§28)
15-წუთიანი reservation `pg_advisory_xact_lock` + `SELECT ... FOR UPDATE`-ით,
ერთსა და იმავე ტრანზაქციაში ([ADR-012](00-index-and-decisions.md)).
დეტალები: [08 §4](08-payment-flow.md).

---

## 6. მდგრადობა (§73–75)

| მექანიზმი | სად |
|-----------|-----|
| Timeout | ყველა provider call — default 5წმ, stock validation 3წმ |
| Retry | exponential backoff + jitter, მხოლოდ იდემპოტენტურ ოპერაციებზე |
| Circuit breaker | partner-ზე; გახსნისას offers `stale`-ად აღინიშნება, **არ ქრება** |
| Stale flag | `last_synced_at` + UI: „Inventory last updated 12 minutes ago“ |
| Graceful degradation | ერთი partner-ის ჩავარდნა სხვების offers-ს არ შლის |
| Idempotency | `Idempotency-Key` header ყველა mutating endpoint-ზე |

**Circuit breaker-ის ნიუანსი:** breaker ღიაა → offers ჩანს stale-ად, **მაგრამ**
Buy/Reserve მომენტში final validation მაინც სცადება (§75). თუ ისიც ჩავარდა —
შეკვეთა არ იწყება. ანუ breaker ამცირებს ხმაურს, არ ცვლის R2-ს.

---

## 7. გარემოები და deployment

| გარემო | დანიშნულება | Providers |
|--------|-------------|-----------|
| `local` | დეველოპერი, docker-compose | ყველა Mock |
| `ci` | ტესტები | ყველა Mock, ephemeral PG |
| `staging` | QA + partner onboarding | vPIC real, payment sandbox |
| `production` | ცოცხალი | vPIC + commercial, real acquirer |

`infra/docker-compose.yml` ასწევს: postgres, redis, opensearch, minio, api.
ერთი ბრძანება — `pnpm dev` — ყველაფერს ადგამს seed data-თი.

### 7.1 Configuration
ყველა provider აირჩევა env-ით, **არა კოდით**:
```
FITMENT_PROVIDER_PRIMARY=nhtsa_vpic
FITMENT_PROVIDER_FALLBACK=mock
PAYMENT_PROVIDER=mock
SMS_PROVIDER=console
DEFAULT_COUNTRY=GE
DEFAULT_CURRENCY=GEL
DEFAULT_LOCALE=ka
FEATURE_REQUEST_PART=false
FEATURE_COURIER_DELIVERY=false
OTP_ECHO_CODE=false
```
`DEFAULT_*` არის **default**, არა hardcode (§80). `if (country === 'GE')` კოდში აკრძალულია.

`SMS_PROVIDER` და `OTP_ECHO_CODE` ერთადერთი ორი პარამეტრია, რომლებსაც
`loadConfig` **production-ში ამოწმებს და უარყოფს**: `console` gateway და
პასუხში დაბრუნებული კოდი development-ის ხელსაწყოებია, და მათი ცოცხალ სისტემაზე
მოხვედრა შესვლის სრულ გვერდის ავლას ნიშნავს ([ADR-015](00-index-and-decisions.md)).

> ⚠ `ConfigModule` რეგისტრირებულია `validate: loadConfig`-ით და **არა**
> `load: [loadConfig]`-ით. `ConfigService.get()` ჯერ validated env-ს კითხულობს
> და მხოლოდ მერე process.env-ს; `load` პირველს არ ავსებს, ამიტომ მასთან ყველა
> მნიშვნელობა ტექსტად ბრუნდება — `FEATURE_REVIEWS=false` ხდება ჭეშმარიტი
> სტრიქონი `"false"` და ყველა feature flag სამუდამოდ ჩართული რჩება.

---

## 8. Backup & Recovery (§96)

- PostgreSQL: ყოველდღიური full + WAL archiving → PITR
- Retention: 30 დღე
- **Restore ტესტი: თვეში ერთხელ, staging-ზე, ავტომატურად.** უტესტო backup არ არსებობს.
- S3: versioning ჩართული
- `search_documents`: **backup არ საჭიროებს** — სრულად აღდგება
  `rebuild_search_documents()`-ით. ეს განზრახ არის: search index არის derived
  data, არა source of truth.

---

## 9. CI/CD

```
PR → lint → typecheck → unit → e2e (ephemeral PostgreSQL) → build
   → migration dry-run → e2e (critical paths) → preview deploy
main → staging → smoke → manual approve → production (blue/green)
```

**Critical path e2e-ები, რომლებიც ყოველ PR-ზე გადის:**
1. VIN → Garage
2. Search → მხოლოდ თავსებადი შედეგები
3. Offer → Reservation → Payment → Order
4. Ready for Pickup → QR → Completed
5. Stock failure → automatic refund

ესენი R1–R3-ს იცავს. თუ ერთ-ერთი ჩავარდა, merge იბლოკება.
