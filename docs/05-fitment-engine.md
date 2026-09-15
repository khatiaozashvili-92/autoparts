# 05 — Fitment Engine

> წყარო: PRD §8–10, §15–18, §55, §97, §102. **ეს არის პროექტის ბირთვი.**
> §10-ის პრიორიტეტების სიაში Fitment Accuracy #1-ია — ამ დოკუმენტში აღწერილი ლოგიკა
> განსაზღვრავს იმ რიცხვს.

---

## 1. რას წყვეტს ძრავა

ერთადერთ კითხვას:

> „ეს კონკრეტული პროდუქტი ნამდვილად შეესაბამება ამ კონკრეტულ ავტომობილს?“

და **არ** წყვეტს: რა უნდა მომხმარებელს, რომელი ბრენდია უკეთესი, რომელი ფასი ჯობია.
ეს სხვა მოდულების საქმეა.

### 1.1 სამი წესი

| # | წესი (§97) |
|---|------------|
| R1 | არასოდეს ვაჩვენებთ პროდუქტს თავსებადად, თუ compatibility დადასტურებული არ არის |
| R3 | Partner data არის input; platform Fitment Engine არის საბოლოო authority |
| §18 | თუ ზუსტი პასუხი არ არის — **სავარაუდო პროდუქტი compatible-ად არ ჩანს** |

**ფუნდამენტური დიზაინის არჩევანი:** ძრავა ასიმეტრიულია. „არ ვიცი“ ითარგმნება როგორც
„არა“, არა როგორც „კი“. შედეგი — ნაკლები ნაჩვენები პროდუქტი, მაგრამ არა არასწორი
პროდუქტი. PRD §2-ის მიხედვით „მთავარი რისკია არასწორი ნაწილის შეძენა“, ანუ ეს
სწორი მიმართულებით შეცდომაა.

---

## 2. Verdict-ები (§16, §55)

| Verdict | მნიშვნელობა | UI (§55) | იყიდება? |
|---------|-------------|----------|----------|
| `EXACT` | VIN/კონფიგურაციით დადასტურებული 100% | ✅ თავსებადია თქვენს BMW 228i-თან | ✅ |
| `COMPATIBLE` | კონფიგურაცია ემთხვევა | ✅ თავსებადია | ✅ |
| `CONDITIONAL` | საჭიროა დამატებითი პირობის დადასტურება | ⚠️ საჭიროა დამატებითი ინფორმაციის დადასტურება | ✅ *პასუხის შემდეგ* |
| `UNCERTAIN` | არასაკმარისი მონაცემი | **არ ჩანს შედეგებში** | ❌ |
| `NOT_COMPATIBLE` | ცალსახად არ ერგება | ❌ არ არის თავსებადი | ❌ |

> **`UNCERTAIN` არ არის UI-ს მდგომარეობა.** §55 სამ მდგომარეობას ასახელებს; `UNCERTAIN`
> მეოთხეა და ის **გაფილტვრის** მიზეზია, არა საჩვენებელი. „Maybe compatible“ პროდუქტის
> გაყიდვა §55-ით პირდაპირ აკრძალულია.

---

## 3. პრიორიტეტების იერარქია (§16)

```
0. ADMIN_MANUAL       ← ადმინის ხელით mapping — ყველაფერზე მაღლა
1. PROVIDER_VIN       ← exact VIN/configuration fitment
2. PROVIDER_CONFIG    ← vehicle configuration fitment
3. OEM_MATCH          ← OEM / part number matching
4. TECHNICAL_DATA     ← ტექნიკური ატრიბუტები
5. PARTNER_DECLARED   ← პარტნიორის მტკიცება
```

**წესი:** უფრო მაღალი პრიორიტეტის წყარო **ყოველთვის** ჭრის უფრო დაბალს.
პარტნიორის `COMPATIBLE` ვერასოდეს გადაფარავს provider-ის `NOT_COMPATIBLE`-ს — ეს
კონფლიქტია (§4 ქვემოთ), არა კამათი.

### 3.1 `ADMIN_MANUAL` რატომ არის 0-ზე და არა 6-ზე

ადმინის ხელით mapping არის **ადამიანის გადამოწმებული** ცოდნა, ხშირად სწორედ იმიტომ
შექმნილი, რომ provider ცდება. თუ ის იერარქიის ბოლოში იქნებოდა, §37-ის („Admin-ს
შეუძლია manually map“) აზრი დაიკარგებოდა. სამაგიეროდ ყოველი `ADMIN_MANUAL` ჩანაწერი
`audit_logs`-ში ფიქსირდება `created_by`-ით (§79).

---

## 4. ალგორითმი

```
evaluate(vehicle, product) → FitmentResult
```

```
1. ADMIN override
   fitments WHERE source='ADMIN_MANUAL' AND product_id=? AND matches(vehicle)
   → თუ არსებობს: დააბრუნე მისი verdict, confidence=1.0. STOP.

2. კონფიგურაციის სისრულის შემოწმება
   requiredAttrs = masterPart.category.requiredVehicleAttributes
   missing = requiredAttrs \ (verified_data ∪ user_supplied_data)
   → თუ missing ≠ ∅ და ვერ შეივსება: UNCERTAIN + missingAttributes. STOP.

3. კანდიდატი fitment ჩანაწერების შეგროვება
   candidates = fitments WHERE product_id=? AND active
                AND matchesCriteria(vehicle)

4. თითოეულ კანდიდატზე verdict-ის გამოთვლა (§5)

5. კონფლიქტის დეტექცია (§17)
   თუ ∃ high-priority NOT_COMPATIBLE და ∃ low-priority COMPATIBLE:
     → შექმენი fitment_conflict (status=OPEN)
     → დააბრუნე NOT_COMPATIBLE   ← პროდუქტი არ ჩანს
   STOP.

6. გამარჯვებულის არჩევა
   იმარჯვებს ყველაზე მაღალი პრიორიტეტის (ყველაზე დაბალი რიგითი ნომრის) წყარო.
   ტოლობისას — ყველაზე მაღალი confidence.

7. CONDITIONAL-ის დამუშავება
   თუ გამარჯვებულს აქვს conditions ≠ {}:
     თუ ყველა პირობა დაკმაყოფილებულია verified_data-ით → COMPATIBLE
     თუ დაკმაყოფილებულია მხოლოდ user_supplied_data-ით → CONDITIONAL (confidence × 0.8)
     თუ პასუხი არ არის → CONDITIONAL + clarification კითხვა

8. ლოგირება
   INSERT INTO fitment_checks (verdict, winning_source, confidence, reasons)
   → ეს KPI „Fitment Accuracy“-ს ერთადერთი წყაროა
```

### 4.1 `matchesCriteria` — market-ის სპეციალური წესი

```ts
function matchesCriteria(v: VehicleConfiguration, f: Fitment): boolean {
  if (norm(f.make) !== norm(v.make)) return false;
  if (f.model && norm(f.model) !== norm(v.model)) return false;
  if (f.yearFrom && v.modelYear < f.yearFrom) return false;
  if (f.yearTo   && v.modelYear > f.yearTo)   return false;

  // NULL კრიტერიუმი = „ნებისმიერი“
  for (const attr of ['generation','engineCode','transmission',
                      'driveType','bodyType','trim','axle','position'] as const) {
    if (f[attr] && norm(f[attr]) !== norm(v[attr])) return false;
  }

  // market — ასიმეტრიული წესი
  if (f.market && v.market && f.market !== v.market) return false;
  if (f.market && !v.market) return false;   // ვიცით რომ მნიშვნელოვანია, არ ვიცით რა გვაქვს

  if (f.productionFrom && v.productionDate && v.productionDate < f.productionFrom) return false;
  if (f.productionTo   && v.productionDate && v.productionDate > f.productionTo)   return false;

  return true;
}
```

**რატომ არის `market` ასიმეტრიული:** სხვა ატრიბუტებისთვის „ჩვენ არ ვიცით“ ნიშნავს
„არ გავფილტროთ“. `market`-ისთვის ეს საშიშია, რადგან საქართველოში US-spec და EU-spec
ერთი და იმავე მოდელის მანქანები **ერთდროულად** დადის ([ADR-003](00-index-and-decisions.md)),
და მათი ნაწილები განსხვავდება. ამიტომ: თუ fitment ჩანაწერი market-ს აზუსტებს, ხოლო
მანქანის market უცნობია — **არ ვთვლით დამთხვევად**.

---

## 5. Confidence

| წყარო | საბაზისო confidence |
|-------|---------------------|
| `ADMIN_MANUAL` | 1.00 |
| `PROVIDER_VIN` | 0.98 |
| `PROVIDER_CONFIG` | 0.90 |
| `OEM_MATCH` (primary OEM, ზუსტი) | 0.85 |
| `OEM_MATCH` (cross-reference) | 0.70 |
| `TECHNICAL_DATA` | 0.60 |
| `PARTNER_DECLARED` (reliability > 0.9) | 0.55 |
| `PARTNER_DECLARED` (reliability ≤ 0.9) | 0.40 |

**მოდიფიკატორები:**
- `user_supplied_data`-ზე დაყრდნობა → `× 0.8`
- `market` არ არის არცერთ მხარეს → `× 0.85`
- პარტნიორის ისტორიული fitment-შეცდომები → `× partner.stock_reliability`

**ბარიერი:** `confidence < 0.50` → `UNCERTAIN`, პროდუქტი არ ჩანს.

> ეს ბარიერი კონფიგურირებადია (`FITMENT_MIN_CONFIDENCE`), მაგრამ **მისი დაწევა
> გაზრდის ნაჩვენებ პროდუქტებს და დაწევს KPI „Fitment Accuracy“-ს.** ეს პირდაპირი
> გაცვლაა და ცნობიერად უნდა გაკეთდეს, არა ჩუმად.

---

## 6. Conflict handling (§17)

```
Partner ამბობს:  COMPATIBLE
Provider ამბობს: NOT_COMPATIBLE
        ↓
fitment_conflicts (status = OPEN)
        ↓
პროდუქტი მომხმარებელს არ ეჩვენება   ← ეს მოქმედებს დაუყოვნებლივ
        ↓
Admin: approve | reject | manually map | investigate
```

**კონფლიქტი არ ბლოკავს სხვა პროდუქტებს** — მხოლოდ ამ ერთ product×vehicle წყვილს.
ადმინის მოქმედებები:

| ქმედება | შედეგი |
|---------|--------|
| `approve` | იქმნება `ADMIN_MANUAL` fitment `COMPATIBLE`-ით; conflict → `APPROVED` |
| `reject` | პარტნიორის fitment → `active=false`; conflict → `REJECTED` |
| `map` | იქმნება `ADMIN_MANUAL` ჩასწორებული კრიტერიუმებით; conflict → `MAPPED` |
| `investigate` | რჩება `OPEN`, ემატება note |

---

## 7. Clarification questions (§10)

როცა კონფიგურაცია არასრულია, სისტემა **ჯერ ცდილობს ავტომატურ fitment-ს** და კითხვას
სვამს **მხოლოდ** მაშინ, როცა ზუსტი იდენტიფიკაცია შეუძლებელია.

```ts
interface ClarificationQuestion {
  id: string;                 // 'brake_config'
  questionKey: string;        // i18n key — არასოდეს raw ტექსტი
  attribute: string;          // რომელ ატრიბუტს ავსებს
  options: { value: string; labelKey: string }[];
  askedBecause: {
    productIds: string[];     // რომელი პროდუქტები დაიბლოკა ამის გამო
    blockedCount: number;
  };
}
```

**როდის ისმება:**
1. VIN-ის დეკოდირებისთანავე, თუ provider აბრუნებს ორაზროვნებას (§10-ის მაგალითი);
2. ძებნისას, თუ ≥3 კანდიდატი პროდუქტი `UNCERTAIN`-ია **ერთი და იმავე** ატრიბუტის გამო.

**როდის არ ისმება:** თუ პასუხი მხოლოდ 1 პროდუქტს ხსნის. ერთი კითხვა ერთი პროდუქტისთვის
UX-ის გადასახადია, რომელიც არ ამართლებს — §45-ის („აპლიკაცია არ უნდა იყოს ტექნიკური“)
სულისკვეთებით.

პასუხი ინახება `vehicles.user_supplied_data`-ში და **მუდმივია** — ერთხელ კითხულობს.

**კითხვა ინახება კონფიგურაციასთან, არა პასუხთან.** `vehicle_configurations.clarifications`
(migration 0002) ინახავს provider-ის დასმულ კითხვებს, ამიტომ იგივე VIN-ის მეორედ
დამატებისას — სხვა მომხმარებლის მიერ ან ქეშიდან — კითხვა კვლავ ისმება.

> რატომ არის ეს კრიტიკული: კითხვის ჩუმად გამოტოვება **არ** ნიშნავს, რომ პასუხი ვიცით.
> ის ტოვებს მანქანას ნაკლებად განსაზღვრულს, და ამ ატრიბუტზე დამოკიდებული ყველა ნაწილი
> `UNCERTAIN`-ად ბრუნდება — ანუ მომხმარებელს არაფერი უჩანს, ახსნის გარეშე.

---

## 8. Search-თან ინტეგრაცია

```
OpenSearch: კანდიდატები (fitment pre-filter ინდექსით — სისწრაფე)
        ↓
FitmentEngine.evaluateBatch(vehicle, candidateIds)   ← სიმართლე
        ↓
გაფილტვრა: EXACT | COMPATIBLE | CONDITIONAL
```

**ინდექსს არასოდეს აქვს ბოლო სიტყვა.** ის შეიძლება მოძველებული იყოს (ახალი conflict,
ახალი admin mapping). ძრავა ყოველთვის ხელახლა თვლის დარჩენილ კანდიდატებზე.

**წარმადობა:** `evaluateBatch` აკეთებს ერთ query-ს ყველა კანდიდატის fitment-ზე,
შემდეგ მეხსიერებაში ითვლის. 100 კანდიდატზე — 1 DB round-trip, < 20მწ.
Redis ქეში: `fitment:{configId}:{productId}` TTL 1სთ, invalidate conflict/mapping-ზე.

---

## 9. ინტერფეისი

```ts
// packages/fitment/src/engine.ts — წმინდა ლოგიკა, DB-ის გარეშე
export interface FitmentEngine {
  evaluate(v: VehicleConfiguration & UserAnswers,
           p: ProductWithFitments): FitmentResult;

  evaluateBatch(v: VehicleConfiguration & UserAnswers,
                ps: ProductWithFitments[]): Map<string, FitmentResult>;

  requiredAttributes(categorySlug: string): string[];
}

export interface FitmentResult {
  verdict: FitmentVerdict;
  confidence: number;
  winningSource: FitmentSource;
  reasons: FitmentReason[];          // ახსნის ჯაჭვი — debugging + admin UI
  missingAttributes?: string[];
  clarification?: ClarificationQuestion;
  conflict?: { claimedVerdict: FitmentVerdict; providerVerdict: FitmentVerdict };
}
```

**`packages/fitment` არ იცის PostgreSQL-ის, NestJS-ის ან HTTP-ის შესახებ.** ის იღებს
ობიექტებს და აბრუნებს verdict-ს. ეს საშუალებას იძლევა:
- unit ტესტები DB-ის გარეშე, ათასობით შემთხვევაზე, წამებში;
- იგივე ლოგიკის გაშვება მობილურზე offline-პრევიუსთვის (P2);
- ძრავის რეფაქტორინგი infrastructure-ის შეხების გარეშე.

---

## 10. ტესტირების სტრატეგია

Fitment არის #1 პრიორიტეტი, ამიტომ მას აქვს ყველაზე მკაცრი ტესტები:

| ტესტი | რას იცავს |
|-------|-----------|
| **Golden set** — 500 ხელით გადამოწმებული vehicle×product წყვილი | რეგრესია. CI-ზე გადის ყოველ PR-ზე; ≥98% უნდა ემთხვეოდეს |
| **Property-based** — შემთხვევითი კონფიგურაციები | `UNCERTAIN` არასოდეს გადაიქცევა `COMPATIBLE`-ად |
| **Priority tests** — თითოეული წყვილი იერარქიიდან | უფრო მაღალი ყოველთვის ჭრის უფრო დაბალს |
| **Market tests** — US-spec vs EU-spec ერთი მოდელი | §4.1-ის ასიმეტრიული წესი |
| **Conflict tests** | conflict იქმნება და პროდუქტი იმავე წამს იმალება |

**Golden set-ის შევსება არის მუდმივი სამუშაო, არა ერთჯერადი.** ყოველი დაბრუნებული
შეკვეთა, რომლის მიზეზიც „არ მოერგო“ იყო, ხდება golden set-ის ახალი ჩანაწერი
(`fitment_checks.was_correct = false`).

---

## 11. მიგრაცია კომერციულ provider-ზე

როცა TecDoc-ის ან სხვა კატალოგის ლიცენზია გაჩნდება:

1. ახალი `CommercialProvider` ამ ინტერფეისზე ([02 §4](02-system-architecture.md));
2. backfill job: ყველა არსებულ product×vehicle-ზე provider-ის verdict-ის მოთხოვნა;
3. სადაც provider ეთანხმება — `confidence` იზრდება ავტომატურად;
4. სადაც არ ეთანხმება — იქმნება `fitment_conflict`, **ადმინის მიმოხილვით**;
5. `PARTNER_DECLARED` რჩება, მაგრამ იშვიათად იმარჯვებს.

**კოდის ცვლილება: მხოლოდ ერთი ახალი adapter კლასი.** ძრავა, schema, API და UI
უცვლელი რჩება — ეს არის ის, რის გამოც §102-ის აბსტრაქცია დღიდანვე შენდება.
