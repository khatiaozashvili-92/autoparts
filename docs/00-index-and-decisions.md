# autoparts — ტექნიკური სპეციფიკაცია

**პროექტი:** `autoparts` (placeholder სახელი — ბრენდის შერჩევისას გადაერქმევა)
**ვერსია:** 1.0
**წყარო:** PRD v1.0 Final (`PRD-automarketplace.docx`), სექციები 1–105
**თარიღი:** 2026-09-15

---

## დოკუმენტების რუკა

| # | დოკუმენტი | რას ფარავს | PRD სექციები |
|---|-----------|-----------|--------------|
| 01 | [product-requirements](01-product-requirements.md) | პროდუქტის მოთხოვნები, scope, KPI, acceptance criteria | 1–6, 84–86, 88–95, 103–105 |
| 02 | [system-architecture](02-system-architecture.md) | სერვისები, მოდულები, repo სტრუქტურა, deployment | 68–75, 96, 100 |
| 03 | [database-schema](03-database-schema.md) | PostgreSQL სრული DDL, ინდექსები, invariants | 62–67, 94 |
| 04 | [api-specification](04-api-specification.md) | REST endpoints, DTO, error model, pagination | 68 |
| 05 | [fitment-engine](05-fitment-engine.md) | თავსებადობის განსაზღვრის ძრავა — ბირთვი | 8–10, 15–18, 97 |
| 06 | [inventory-integration](06-inventory-integration.md) | Partner Integration Layer, API/CSV/Manual, sync | 24–30, 57–58, 71, 74–75 |
| 07 | [authentication](07-authentication.md) | Auth, RBAC, უსაფრთხოება | 7, 76–77 |
| 08 | [payment-flow](08-payment-flow.md) | გადახდა, markup, settlement, refund | 31–33, 44, 51–53, 64, 66–67 |
| 09 | [admin-panel](09-admin-panel.md) | Admin Panel | 59, 79 |
| 10 | [partner-portal](10-partner-portal.md) | Partner Dashboard | 56, 99 |
| 11 | [mobile-app](11-mobile-app.md) | React Native აპლიკაცია | 81, 83, 98 |
| 12 | [web-app](12-web-app.md) | Next.js ვებ პლატფორმა | 82–83 |

---

## აშენების თანმიმდევრობა

PRD §100-ის მიხედვით. **თითოეული ნაბიჯი დასრულებული და ტესტირებულია შემდეგზე გადასვლამდე.**

> **სტატუსი: სამივე თორმეტი ნაბიჯი დასრულებულია.** 47 unit და 200 end-to-end
> assertion გადის. რაც გაშვებამდე რჩება, კოდი აღარ არის — იხ. ღია საკითხები ქვემოთ.

| Step | შინაარსი | დოკუმენტი | გამომავალი |
|------|----------|-----------|------------|
| 1 | Architecture — monorepo, env, API conventions, RBAC | 02, 07 | ჩონჩხი ეშვება |
| 2 | Data Layer — schema, migrations, entities, seed | 03 | `pnpm db:migrate && pnpm db:seed` |
| 3 | Vehicle/VIN — abstraction, **MockProvider**, Garage | 05 | VIN → Garage მუშაობს |
| 4 | Catalog — Brand, Category, MasterPart, Product, Offer | 03, 04 | კატალოგი დგას |
| 5 | **Fitment Engine** — rules, verdicts, conflicts | 05 | მხოლოდ თავსებადი ჩანს |
| 6 | Partner — dashboard, manual inventory, CSV, abstraction | 06, 10 | პარტნიორს შეაქვს მარაგი |
| 7 | Search — OpenSearch, ka/en, synonyms, fitment filter | 02, 05 | ძებნა <2–3 წმ |
| 8 | Marketplace — offers, sorting, filters, markup | 08 | შეთავაზებების შედარება |
| 9 | Orders — cart, reservation, order, payment, refund | 08 | გადახდა → შეკვეთა |
| 10 | Pickup — Ready for Pickup, QR, 24h expiry | 01, 10 | სრული lifecycle |
| 11 | Admin — სრული პანელი | 09 | marketplace იმართება |
| 12 | Web/Mobile UX — polished UI | 11, 12 | გაშვებადი პროდუქტი |

**პლატფორმები:** სპეცი სამივეს ფარავს (web + iOS + Android). Step 1–11 backend-ს და
მინიმალურ UI-ს აშენებს; Step 12-ზე ერთდროულად ეწყობა Next.js და React Native, საერთო
`@autoparts/api-client` და `@autoparts/core` პაკეტებზე.

---

## გადაწყვეტილებების ჟურნალი (ADR)

ქვემოთ ჩამოთვლილია გადაწყვეტილებები, რომლებიც PRD-ში ღია ან წინააღმდეგობრივი იყო და
სპეცის დაწერისას დაიხურა. **თითოეული ცვლადია — მაგრამ სანამ არ შეიცვლება, ყველა დოკუმენტი
ამას მიჰყვება.**

### ADR-001 — გადახდის მოდელი: §32 იმარჯვებს §44-ზე

**კონფლიქტი:** §32 ამბობს `Customer Price = Partner Base Price + Platform Markup`.
§44 ამბობს „Customer payment → Partner, Platform იღებს commission-ს ცალკე“.

**გადაწყვეტილება:** ეს **ერთი** ნაკადია, არა ორი. მომხმარებელი იხდის **ერთ** თანხას
(`customer_price`) პლატფორმას; პლატფორმა settlement-ზე უგზავნის პარტნიორს `base_price`-ს
და იტოვებს `platform_markup`-ს.

**რატომ:** ამას თავად PRD-ის data model ადასტურებს — `Offer` (§64) ინახავს სამივე ველს
(`base_price`, `platform_markup`, `customer_price`), `Order` (§66) ინახავს
`subtotal / markup / total`-ს, `Payment` (§67) ინახავს ერთ `amount`-ს და `commission`-ს,
და §62-ში ცალკე entity-დაა `Settlement`. ორი დამოუკიდებელი გადახდა ამ მოდელს არ სჭირდება.
§44-ის ფრაზა აღწერს **ეკონომიკურ** შედეგს, არა ტრანზაქციების რაოდენობას.

**შედეგი:** პლატფორმა არის merchant of record → სჭირდება იურიდიული პირი და
split-settlement ხელშეკრულება acquirer-თან. ეს **იურიდიული blocker-ია**, არა ტექნიკური —
იხ. `08-payment-flow.md` §9.

**ბიზნეს-რისკი, რომელიც ცალკე უნდა გაიზომოს:** markup მყიდველზე გადადის, ანუ პლატფორმის
ფასი იმავე მაღაზიის ფასზე ძვირია → showrooming. საზომი: `Offer→Purchase Rate` (§61).
თუ ის დაბალია, `platform_markup` კონფიგურირებადია partner/category დონეზე (§33) და
გამყიდველზე გადატანა **schema-ს ცვლილებას არ საჭიროებს** — მხოლოდ `price_rules`-ის ცვლილებას.

### ADR-002 — Request Part არის P1, მაგრამ schema P0-შია

**კონფლიქტი:** §85 Request Part-ს P1-ში აყენებს, მაგრამ §78 (MVP notifications),
§56 (Partner Dashboard → Requests) და §59 (Admin → Requests) მას MVP-ში ახსენებს.

**გადაწყვეტილება:**
- `request_parts` და `partner_offers` ცხრილები **იქმნება Step 2-ზე** (P0 migration-ში);
- `NotificationType.REQUEST_PART_RESPONSE` **რეგისტრირდება** enum-ში P0-ზე;
- UI, API endpoints და notification trigger **P1-შია**;
- Partner/Admin dashboard-ის „Requests“ სექცია P0-ზე ჩანს ცარიელი empty-state-ით.

**რატომ:** ასე P1-ის ჩართვა **migration-ს არ საჭიროებს** — მხოლოდ feature flag-ს
(`FEATURE_REQUEST_PART`). §53-ის „ცოცხალი“ ცხრილების მიგრაცია production-ზე ძვირია.

### ADR-003 — VIN provider: Mock პირველი, NHTSA vPIC უფასო adapter, კომერციული slot

**გადაწყვეტილება:** `FitmentProvider` ინტერფეისი (§102) სამი იმპლემენტაციით:

| Adapter | როდის | ღირებულება | დაფარვა |
|---------|-------|------------|---------|
| `MockFitmentProvider` | Step 3–11, ტესტები, CI | 0 | სემინარული seed data |
| `NhtsaVpicProvider` | Production, პირველი რიგი | **0, ულიმიტო** | US-spec მანქანები |
| `CommercialProvider` | Production, fallback | €0.22–0.49 / VIN | EU-spec + სიღრმე |

**რატომ NHTSA vPIC არის რეალური ვარიანტი და არა მხოლოდ სათამაშო:** საქართველოში 2024-ში
70,000+ მეორადი ავტომობილი შემოვიდა, უმრავლესობა Copart / IAAI / Manheim-იდან — ანუ
**US-spec**. vPIC სწორედ US-market VIN-ებს შლის (make, model, year, engine, displacement,
body, drivetrain, plant), უფასოდ და ულიმიტოდ.

**კრიტიკული შედეგი:** US-spec და EU-spec ერთი და იმავე მოდელის ნაწილები **განსხვავდება**.
ამიტომ `market` (§10, §63) არის **სავალდებულო** ველი fitment-ში, არა სასურველი —
იხ. `05-fitment-engine.md` §4.

**ქეშირება:** VIN ერთხელ იშიფრება და სამუდამოდ ინახება `vehicle_configurations`-ში.
15,000 უნიკალურ მანქანაზე კომერციული provider ≈ €3,300 **ერთჯერადად**, არა განმეორებადად.

### ADR-004 — Fitment: OEM ნომერი ხერხემალი, TecDoc მოგვიანებით

**გადაწყვეტილება:** MVP-ის fitment ეყრდნობა OEM/part-number matching-ს + პარტნიორის
declared fitment-ს + ადმინის override-ს. ლიცენზირებული კატალოგი (TecDoc) **არ არის
MVP-ის დამოკიდებულება**.

**რატომ:** TecDoc-ს საჯარო ფასი არ აქვს — ხელშეკრულება წლიურად, ბრუნვის პროცენტზე +
წლიურ მინიმუმზე იკვრება, და ლიცენზიის გარეშე მისი მონაცემებით მაღაზიის გაშვება
**აკრძალულია**. pre-revenue სტარტაპისთვის ეს კვირებს/თვეებს და ფულს ნიშნავს **სანამ ერთი
ხაზი კოდი დაიწერება**.

**რაც ამას უსაფრთხოს ხდის:** §16-ის პრიორიტეტების იერარქია და §18-ის წესი —
*გაურკვევლობისას პროდუქტი თავსებადად არ ჩანს*. ანუ დაბალი ხარისხის fitment-ის ფასი არის
**ნაკლები შედეგი**, და არა **არასწორი შედეგი**. ეს სწორი მიმართულებით შეცდომაა.

### ADR-005 — ფულის შენახვა: `bigint` minor units

**გადაწყვეტილება:** ყველა ფულადი თანხა ინახება `bigint`-ად, ვალუტის **minor unit**-ში
(GEL → თეთრი, USD → cent), გვერდით `char(3)` ISO-4217 კოდით. `float`/`double` აკრძალულია.

**რატომ:** 420.50 ₾ = `42050`. floating point-ში `0.1 + 0.2 != 0.3`, და marketplace-ში
ეს settlement-ის განსხვავებას ნიშნავს. `numeric` მუშაობს, მაგრამ ორივე მხარეს
(TS ↔ PG) `bigint` minor units უფრო უსაფრთხოა, რადგან JS-ის `number`-ში გადაბარება
არ ხდება — გამოიყენება `bigint`/`string`.

### ADR-006 — პარტნიორის ინტეგრაციის რიგი: Manual → CSV → API

**გადაწყვეტილება:** §24-ის სამივე გზა სპეცშია, მაგრამ **აშენების რიგი** არის
Manual dashboard → CSV import → API integration.

**რატომ:** MVP-ის სამიზნეა 5–10 პარტნიორი (§4). მათგან დღის პირველ დღეს ვერცერთს ექნება
მზა API. თუ API-თი დავიწყებთ, Step 6 დასრულდება ისე, რომ **ვერცერთი პარტნიორი ვერ
შემოვა**. Manual-ით კი პირველივე დღეს შემოდის.

### ADR-007 — დოკუმენტების ენა

ქართული პროზა + ინგლისური ტექნიკური ტერმინები და იდენტიფიკატორები — PRD-ის საკუთარი
სტილი. კოდი, schema, API, enum-ები, commit messages: **მხოლოდ ინგლისური**.
UI-ს ტექსტები არსად არ არის hardcoded — იხ. §80 და `12-web-app.md` §7.


### ADR-008 — DB წვდომა: raw SQL migration-ები, არა Prisma

**გადაწყვეტილება:** schema იწერება raw SQL migration-ებად (`db/migrations/*.sql`),
გატარება — საკუთარი runner-ით checksum-ის დაცვით. ORM-ის schema ენა არ გამოიყენება.

**რატომ:** `docs/01 §7`-ის data quality წესები განზრახ **ბაზის დონეზეა** აღსრულებული,
და ეს ეყრდნობა PostgreSQL-ის შესაძლებლობებს, რომელთაც Prisma-ს schema ენა **ვერ**
გამოხატავს:

| საჭირო | Prisma schema |
|--------|---------------|
| `customer_price_minor` generated column | ❌ |
| `CHECK` constraint (უარყოფითი ფასი, settlement-ის მათემატიკა) | ❌ |
| partial / expression unique index (`COALESCE(...)`) | ❌ |
| `offer_availability` VIEW | ❌ |
| `citext`, `bytea`, `inet`, `text[]` | ნაწილობრივ |

Prisma-თი ეს ყველაფერი მაინც ხელით SQL-ში დაიწერებოდა, Prisma კი მათ თავის schema-ში
ვერ დაინახავდა და შემდეგ introspection-ზე წაშლას შემოგვთავაზებდა. ანუ ORM აქ
**ეწინააღმდეგება** პროექტის დეკლარირებულ პრინციპს, და არა ეხმარება.

**ფასი:** ტიპიზებული query builder ცალკე უნდა აეწყოს (Step 4-ზე, კატალოგის endpoint-ებთან
ერთად). Migration runner უკვე იცავს checksum-ს: გატარებული migration-ის შეცვლა
შეცდომას იწვევს, არა ჩუმ დრიფტს.

### ADR-009 — ლოკალური PostgreSQL portable ბინარებით, არა Docker

**გადაწყვეტილება:** development-ის ბაზა არის PostgreSQL 16.4 **portable binaries**,
გაშვებული user-space-იდან (`%LOCALAPPDATA%autoparts-pg`), პორტი **5433**.
`infra/docker-compose.yml` რჩება — ის არის CI-სა და იმ დეველოპერებისთვის, ვისაც Docker აქვს.

**რატომ:** Docker Desktop-ის ინსტალაცია ამ მანქანაზე მოითხოვს ადმინის უფლებას **და**
WSL2-ს (რომელიც თავად მოითხოვს ადმინს + გადატვირთვას). ინსტალერი ჩავარდა კოდით
`4294967291` — UAC-ის უარყოფა. portable ბინარები ამ სამივეს გვერდს უვლის და Step 2
დაუყოვნებლივ იხსნება.

**რა იცვლება Docker-ის გაჩენისას:** მხოლოდ `DATABASE_URL` (პორტი 5433 → 5432).
სქემა, migration-ები და კოდი უცვლელია.

**რა რჩება დაბლოკილი:** Redis (Step 9) და OpenSearch (Step 7). ორივე Docker-ს ან
ცალკე ინსტალაციას საჭიროებს — ეს Step 6-მდე უნდა გადაწყდეს.

### ADR-010 — Search: PostgreSQL, არა OpenSearch

**გადაწყვეტილება:** ძებნა დგას PostgreSQL-ზე (`tsvector` + `pg_trgm`).
`docs/02`-ის OpenSearch რჩება ინტერფეისის უკან შესაძლებლობად, მაგრამ MVP მას არ იყენებს.

**რატომ:** საძებნი ლექსიკონი არის რამდენიმე ათასი master part და მათი სინონიმი —
არა მილიონობით დოკუმენტი. PostgreSQL ამ მასშტაბზე ფარავს §13-ის ყველა მოთხოვნას:
ორი ენა, სინონიმები, typo tolerance, OEM/SKU lookup. ერთი მონაცემთა ბაზა ორის ნაცვლად
უფრო ღირებულია, ვიდრე ჯერ გამოუყენებელი მარაგი.

**ორი რამ, რაც ამან გამოააშკარავა:**

1. **`similarity()` არასწორი ფუნქციაა.** ინდექსირებული ტექსტი მთელი დოკუმენტია
   (სახელი + ყველა სინონიმი + კატეგორია), ამიტომ ორსიტყვიანი შეკითხვა მთელთან
   შედარებისას ყოველთვის ნულთან ახლოს ქულავდება. სწორია `word_similarity()`,
   რომელიც შეკითხვას დოკუმენტის შიგნით საუკეთესო სიტყვათა მონაკვეთს ადარებს.

2. **`pg_trgm` ქართულისთვის ტრიგრამებს საერთოდ არ აწარმოებს** Latin ctype-ზე —
   `show_trgm('რადიატრი')` აბრუნებს `{}`. ეს არის ჩუმი ჩავარდნა: შეცდომა არ არის,
   უბრალოდ fuzzy ძებნა ქართულად ყოველთვის ცარიელია. ამიტომ ტრიგრამები აშენებულია
   **ტრანსლიტერირებულ** ასლზე (migration 0006) — შედეგი ერთნაირია Windows-ზე,
   Linux-ზე და CI-ში, და ჰოსტის ლოკალზე აღარაფერია დამოკიდებული.

### ADR-011 — ბაზის ლოკალი არ უნდა იყოს `C`

**გადაწყვეტილება:** development-ის კლასტერი იქმნება UTF-8 ctype-ით
(`English_United States.utf8`), არა `--locale=C`-ით.

**რატომ:** `C` ლოკალზე არა-ASCII სიმბოლოები ასოებად არ ითვლება. ეს ტექსტურ ძებნას
და `pg_trgm`-ს ჩუმად ამტვრევს — ისევ შეცდომის გარეშე. ეს პირველი კლასტერის შექმნისას
დაშვებული შეცდომა იყო და კლასტერი ხელახლა შეიქმნა.

> **გაშვებამდე შესამოწმებელი:** production-ის ბაზაც UTF-8 ctype-ით უნდა შეიქმნას.
> ტრანსლიტერაცია fuzzy ძებნას იცავს, მაგრამ `to_tsvector` და `ILIKE` მაინც ctype-ზეა
> დამოკიდებული.

### ADR-012 — Reservation locking: Postgres advisory locks, არა Redis

**გადაწყვეტილება:** მარაგის რეზერვაცია სერიალიზდება `pg_advisory_xact_lock`-ით
+ `SELECT ... FOR UPDATE`-ით, ერთსა და იმავე ტრანზაქციაში. Redis არ გამოიყენება.

**რატომ:** განაწილებული lock საჭიროა მაშინ, როცა კრიტიკული სექცია ბაზის გარეთაა.
აქ ის ბაზის **შიგნითაა** — რეზერვაცია იმავე ტრანზაქციაშია, რომელსაც lock იცავს.
Redis ამ შემთხვევაში ამატებს ოპერაციულ დამოკიდებულებას, მაგრამ არ ამატებს გარანტიას.

**რატომ ორივე (advisory lock **და** row lock):** მხოლოდ row lock არ ფარავს
`reservations`-ზე აგრეგატს (`SUM(quantity)`), ხოლო მხოლოდ advisory lock ტრანზაქციის
დასრულებისას თავისუფლდება. ერთად ისინი ხურავენ ფანჯარას, რომელსაც თითოეული ცალკე
ტოვებს.

**Fallback-ის გარეშე უსაფრთხოა:** `offer_availability` view უკვე გამორიცხავს
ვადაგასულ რეზერვაციებს, ამიტომ მარაგი თავისუფლდება ვადის გასვლისთანავე — მომსვლელი
job მხოლოდ ჩანაწერებს ასწორებს ანგარიშგებისთვის.

### ADR-013 — Partner და Admin UI: იმავე Next აპლიკაციაში

**გადაწყვეტილება:** `docs/02`-ში ჩამოთვლილი `apps/partner` და `apps/admin`
რეალიზებულია როგორც `/partner` და `/admin` მარშრუტები `apps/web`-ში.

**რატომ:** MVP-ის მასშტაბზე სამი ცალკე Next აპლიკაცია სამმაგ build/deploy სამუშაოს
ნიშნავს ერთი და იმავე კოდის ბაზაზე. Next მარშრუტების მიხედვით ყოფს bundle-ს, ამიტომ
ადმინის კოდი მომხმარებლის bundle-ში არ ხვდება.

**რატომ არის ეს უსაფრთხო:** როლები აღსრულებულია **სერვერზე** — `RolesGuard` +
partner-scoped query-ები (`docs/07 §5.1`). UI-ის გაყოფა წვდომას არ ცვლის; ის
მხოლოდ deploy-ის საზღვარია. გაყოფა მოგვიანებით საქაღალდის გადატანაა.

### ADR-014 — ორი React მაჟორი ერთ repo-ში

**პრობლემა:** ვები React 19-ზეა, React Native 0.76 კი React 18-ს მოითხოვს. pnpm-მა
`next`-ის ნებადამრთველი peer range (`^18 || ^19`) დააკმაყოფილა mobile-ის მიერ
შემოტანილი **18.3.31** ასლით. შედეგად next-ის საკუთარი `styled-jsx` ტიპები React 18-ს
ხსნიდნენ და ვების build-ს ორი შეუთავსებელი `ReactNode` განსაზღვრება ჰქონდა.

**სიმპტომი:** `'Suspense' cannot be used as a JSX component` — შეცდომა, რომელიც
Suspense-ზე არაფერს ამბობს.

**გადაწყვეტილება:** `apps/web/tsconfig.json`-ში `paths` აფიქსირებს `react`-სა და
`react-dom`-ს ამ აპლიკაციის საკუთარ ასლზე. ყოველი `react`-ის იმპორტი — next-ის
ტიპების შიგნითაც — ერთ ვერსიაზე იხსნება. mobile ინარჩუნებს თავის React 18-ს.

---

## ღია საკითხები (ბიზნესი, არა კოდი)

ეს ვერ დაიხურა სპეცით და **პარალელურად უნდა მოგვარდეს development-თან ერთად**:

| # | საკითხი | ბლოკავს | ვადა |
|---|---------|---------|------|
| 1 | იურიდიული პირი + acquirer ხელშეკრულება (BOG / TBC / სხვა) split-settlement-ით | Step 9 (real payment) | Step 6-მდე |
| 2 | 5–10 პარტნიორის წერილობითი დათანხმება | Step 6 (რეალური მონაცემი) | Step 5-მდე |
| 3 | კომერციული VIN provider-ის შერჩევა EU-spec fallback-ისთვის | Step 3-ის production რეჟიმი | Step 7-მდე |
| 4 | Return policy-ის იურიდიული ტექსტი (§53) | Step 9 (checkout) | Step 9-მდე |
| 5 | პერსონალურ მონაცემთა დაცვის შესაბამისობა (VIN + მისამართი) | გაშვება | გაშვებამდე |

**#1 და #2 ყველაზე მნიშვნელოვანია.** ტექნიკურად Step 1–11 მათ გარეშეც შესრულდება
(mock provider + mock payment), მაგრამ **გაშვება მათ გარეშე შეუძლებელია.**
