# 06 — Inventory & Partner Integration

> წყარო: PRD §24–30, §57–58, §71, §74–75. აშენების რიგი: [ADR-006](00-index-and-decisions.md) — Manual → CSV → API.

---

## 1. Partner Integration Layer (§71)

პარტნიორების ERP-ები **არასოდეს** ებმება core business logic-ს. შუაში დგას ფენა,
რომელიც სხვადასხვა ფორმატს ერთ სტანდარტად აქცევს:

```
Partner A: { "stock_qty": 5 }
Partner B: { "available": true, "count": 5 }
Partner C: { "qty": "5" }
                    ↓
        PartnerIntegrationLayer
                    ↓
        inventory.quantity = 5
        inventory.status   = IN_STOCK
```

```ts
export interface PartnerIntegrationAdapter {
  readonly mode: 'API' | 'CSV' | 'MANUAL';
  fetchInventory(partner: Partner): Promise<NormalizedInventoryItem[]>;
  checkStock(offer: Offer, qty: number): Promise<StockCheckResult>;
  pushOrder?(order: PartnerOrder): Promise<PartnerOrderAck>;
  healthCheck(): Promise<HealthStatus>;
}

export interface NormalizedInventoryItem {
  sku: string;
  identifiers: { kind: 'OEM'|'MPN'|'EAN'; value: string }[];
  productName: string;
  brandName: string;
  priceMinor: bigint;
  currency: string;
  quantity: number;
  availability: 'IN_STOCK' | 'AVAILABLE_TO_ORDER' | 'UNAVAILABLE';
  expectedAvailabilityDays?: number;
  declaredFitment?: DeclaredFitment[];   // → PARTNER_DECLARED, პრიორიტეტი 5
  warrantyMonths?: number;
  imageUrls?: string[];
}
```

**თითოეული პარტნიორის ველების რუკა ინახება DB-ში, არა კოდში:**
`partners.field_mapping jsonb`. ახალი პარტნიორის დამატება deploy-ს არ საჭიროებს.

---

## 2. სამი რეჟიმი (§24)

| რეჟიმი | ვისთვის | სიხშირე | აშენების რიგი |
|--------|---------|---------|---------------|
| **MANUAL** | პატარა მაღაზია, პირველი პარტნიორები | ხელით | **1-ლი** |
| **CSV** | საშუალო, Excel-ზე მომუშავე | დღეში 1–4-ჯერ | **მე-2** |
| **API** | ERP-ის მქონე დილერი | 5–15 წუთი | **მე-3** |

> რატომ ამ რიგით: MVP-ის სამიზნეა 5–10 პარტნიორი (§4), და მათგან პირველ დღეს
> ვერცერთს ექნება მზა API. API-ით დაწყება ნიშნავს, რომ Step 6 დასრულდება ისე, რომ
> ვერცერთი პარტნიორი ვერ შემოვა.

### 2.1 მინიმალური მონაცემი (§25)

**სავალდებულო:** SKU · OEM/Part Number · Product Name · Brand · Price · Stock · Availability
**სასურველი:** Fitment · Technical data · Images · Warranty · Expected availability

თუ სავალდებულო ველი აკლია — row უარყოფილია row-level შეცდომით, **დანარჩენი row-ები
მაინც შედის** (partial sync).

---

## 3. Sync მოდელი (§26)

```
Partner inventory
     ↓ periodic (API) | upload (CSV) | edit (Manual)
Integration Layer — normalization
     ↓
Product Matching (§4)
     ↓
Fitment Validation ([05](05-fitment-engine.md))
     ↓
offers + inventory (ჩვენი DB)
     ↓
OpenSearch reindex (async)
     ↓  ... ძებნა სწრაფია ...
Real-time final stock check       ← R2
     ↓
Reserve → Pay
```

**ჰიბრიდის აზრი:** ქეშირებული მარაგი აჩქარებს ძებნას; **მაგრამ ყიდვის მომენტში
ქეშს არავინ ენდობა.** ეს არის R2-ის (§97) პირდაპირი იმპლემენტაცია.

---

## 4. Product Matching (§58)

```
Step 1 — Exact identifier matching
   normalize(OEM) → product_identifiers.normalized
   normalize(MPN) → product_identifiers.normalized
   → ერთი დამთხვევა? მიაბი. STOP.

Step 2 — Fitment + technical attributes
   იგივე master_part + იგივე brand + თავსებადი ატრიბუტები
   → confidence ≥ 0.9? მიაბი. STOP.

Step 3 — Ambiguity → Admin Review
   იქმნება matching_review ჩანაწერი; offer არააქტიურია სანამ არ გადაწყდება
```

> **სისტემა არასოდეს აერთიანებს ორ პროდუქტს მხოლოდ სახელის მსგავსების გამო (§58).**
> „Brake Pad Front“ და „Front Brake Pads“ სახელით ერთნაირია, OEM-ით შეიძლება სხვადასხვა
> მანქანა იყოს. სახელი არის ძებნის სიგნალი, არა იდენტობის.

### 4.1 Normalization

```ts
// packages/core/src/identifier.ts — ერთადერთი ადგილი
export function normalizeIdentifier(raw: string): string {
  return raw.toUpperCase()
            .replace(/[\s\-._/]/g, '')
            .replace(/[^A-Z0-9]/g, '');
}
// '34 11 6 850 568' → '34116850568'
// 'bp-2211/a'       → 'BP2211A'
```
იგივე ფუნქცია გამოიყენება import-ზე, ძებნაზე და matching-ზე. სხვა ადგილას
normalization-ის დაწერა აკრძალულია — განსხვავება ჩუმად გატეხავს matching-ს.

---

## 5. CSV Import (§57)

```
Upload → Validate → Normalize → Match → Fitment Validation → Import
```

| ეტაპი | რას ამოწმებს |
|-------|--------------|
| Upload | ფორმატი (csv/xlsx), ზომა ≤ 20MB, encoding (UTF-8 BOM-იც) |
| Validate | სავალდებულო სვეტები, ტიპები, დადებითი ფასი/მარაგი |
| Normalize | identifiers, ბრენდის სახელი, ვალუტა, availability enum |
| Match | §4-ის სამი ნაბიჯი |
| Fitment | declared fitment → `PARTNER_DECLARED`; conflict-ის შემოწმება |
| Import | upsert `offers`-ში ტრანზაქციაში |

**შეცდომები row-ის ზუსტი მითითებით (§57):**
```json
{ "syncId":"…", "status":"PARTIAL",
  "rowsTotal":1250, "rowsOk":1198, "rowsFailed":52,
  "errors":[
    {"row":17,"column":"price","code":"NEGATIVE_PRICE","value":"-40"},
    {"row":23,"column":"oem","code":"INVALID_OEM_FORMAT","value":"??"},
    {"row":88,"column":"sku","code":"DUPLICATE_IN_FILE","value":"BP-2211"}
  ],
  "errorReportUrl":"https://…/sync/…/errors.csv" }
```
პარტნიორი ჩამოტვირთავს შეცდომების CSV-ს, ასწორებს და თავიდან ტვირთავს.

**შაბლონი:** `/partner/inventory/template.csv` — ჩამოსატვირთი, სწორი სვეტებით და
2 მაგალითი row-ით. ეს ყველაზე იაფი გზაა support-ის დატვირთვის შესამცირებლად.

---

## 6. Availability (§27)

| სტატუსი | მნიშვნელობა | reservation? |
|---------|-------------|--------------|
| `IN_STOCK` | ფიზიკურად არის მარაგში | ✅ 15 წუთი |
| `AVAILABLE_TO_ORDER` | პარტნიორს შეუძლია მოპოვება | ❌ — მარაგი არ არსებობს |
| `UNAVAILABLE` | შეუძლებელია მიწოდება | ❌ არ ჩანს |

Customer filter: `In Stock` | `Available to Order` | `Both`.

### 6.1 Available-to-Order (§36)

მომხმარებელმა **წინასწარ** უნდა ნახოს: ფასი · estimated availability · payment terms ·
warranty · partner conditions.

`payment_terms`: `FULL_PREPAYMENT` | `PARTIAL_ADVANCE` | `PAY_ON_ARRIVAL` | `OTHER`.

> MVP-ში checkout სრულად მუშაობს მხოლოდ `FULL_PREPAYMENT`-ზე. დანარჩენი სამი
> **ჩანს offer-ზე** და პარტნიორს შეუძლია მითითება, მაგრამ ონლაინ გადახდის flow
> მათზე P1-შია. offer-ზე მკაფიოდ წერია რომელი პირობაა, რომ მომხმარებელი არ მოტყუვდეს.

---

## 7. Reservation (§28)

```
stock_quantity        = 5    (პარტნიორის მარაგი ჩვენს DB-ში)
active reservations   = 1
marketplace available = 4
```

| წესი | მნიშვნელობა |
|------|-------------|
| ხანგრძლივობა | **15 წუთი** |
| მოქმედების არე | მხოლოდ marketplace — **პარტნიორის ERP არ იბლოკება** |
| ვადის გასვლა | ავტომატური `EXPIRED`, available ბრუნდება |
| მხოლოდ | `IN_STOCK` offer-ებზე |

**კონკურენტული წვდომის უსაფრთხოება:**
```ts
await redis.lock(`offer:${offerId}`, 5_000, async () => {
  const { available } = await db.queryOne(
    `SELECT available FROM offer_availability WHERE offer_id = $1 FOR UPDATE`, [offerId]);
  if (available < qty) throw new StockUnavailableError(available);
  await db.insert('reservations', { offerId, userId, quantity: qty,
    expiresAt: addMinutes(new Date(), 15) });
});
```
ორმაგი დაცვა (Redis lock + `FOR UPDATE`) განზრახია: Redis-ის გადატვირთვა lock-ს კარგავს,
DB-ის row lock კი ტრანზაქციას იცავს. Invariant I1.

**Expiry job:** BullMQ, ყოველ 30 წამში — `expires_at < now() AND status='ACTIVE'` → `EXPIRED`.

---

## 8. Real-time stock validation (§29)

Buy/Reserve მომენტში — **ყოველთვის**, ქეშის მიუხედავად:

```
checkStock(offer, qty)
   ↓
partner adapter (timeout 3წმ)
   ↓
Available   → გრძელდება
Unavailable → შეკვეთა არ იწყება (422 STOCK_UNAVAILABLE)
Timeout     → იხ. §8.1
```

ყოველი შემოწმება ლოგდება `inventory_checks`-ში — KPI „Inventory Accuracy“ (§61).

### 8.1 როცა partner API დუმს ყიდვის მომენტში

ეს არის ყველაზე დელიკატური წერტილი. სამი ვარიანტი:

| partner reliability | ქეშის ასაკი | გადაწყვეტილება |
|---------------------|-------------|----------------|
| > 0.95 | < 15 წუთი | **გავაგრძელოთ** ქეშზე დაყრდნობით; თუ ცდება — §30 refund |
| ნებისმიერი | > 60 წუთი | **შევაჩეროთ** — 503, „სცადეთ მოგვიანებით“ |
| ≤ 0.95 | ნებისმიერი | **შევაჩეროთ** |

**რატომ არა ყოველთვის „შევაჩეროთ“:** სანდო პარტნიორის დროებითი ჩავარდნისას
გაყიდვის სრული ბლოკირება უფრო ძვირია, ვიდრე იშვიათი ავტომატური refund. მაგრამ ეს
დათმობა მხოლოდ **გაზომილი** სანდოობის საფუძველზე კეთდება, არა იმედით.

---

## 9. Stock failure გადახდის შემდეგ (§30)

```
Payment captured → final check → UNAVAILABLE
   ↓
order.status = FAILED
   ↓
Automatic FULL refund (reason = STOCK_FAILURE)
   ↓
Customer notification
   ↓
partner.stock_reliability ↓
```
**პროდუქტის თვითნებური ჩანაცვლება არ ხდება (§30).** არც „მსგავსი“, არც „უკეთესი“.

---

## 10. Stock Reliability Score (§74)

```
reliability = w1·sync_accuracy + w2·(1 − cancel_rate)
            + w3·(1 − mismatch_rate) + w4·completion_rate
```
საწყისი წონები: `w1=0.3, w2=0.25, w3=0.3, w4=0.15`. გადაითვლება ღამით,
ბოლო 90 დღეზე, მინიმუმ 20 შეკვეთის შემდეგ (მანამდე — 1.0 ნეიტრალურად).

გამოიყენება: Recommended ranking (§35) · §8.1-ის გადაწყვეტილება ·
Admin alert როცა < 0.8 · პარტნიორის dashboard-ზე ჩანს **მას თვითონაც**.

---

## 11. Failure handling (§75)

| მექანიზმი | პარამეტრი |
|-----------|-----------|
| Timeout | sync 30წმ · stock check 3წმ |
| Retry | 3 მცდელობა, exponential + jitter |
| Circuit breaker | 5 ჩავარდნა / 1 წუთი → ღიაა 5 წუთი |
| Stale flag | `last_synced_at` > 30 წუთი → `is_stale = true` |
| Degradation | breaker ღიაა → offers **რჩება**, მონიშნულია stale-ად |

**Marketplace არასოდეს ჩერდება ერთი პარტნიორის გამო (§73).** breaker ღიაა
→ იმ პარტნიორის offers stale-ია; დანარჩენები ნორმალურად მუშაობს.

UI-ს მოთხოვნა: `stock.ageMinutes` ყოველთვის ჩანს —
„Stock updated 2 min ago“ / „Availability last updated 2 hours ago“ (§22 v1, §73).

---

## 12. Partner onboarding (§99)

```
Registration → Admin Approval → Profile → Add Location
→ Connect Inventory (MANUAL პირველ დღეს)
→ Product Normalization → Fitment Validation → Offers Live
```

**Offers არ ცოცხლდება, სანამ:**
1. პარტნიორი არ არის `APPROVED`;
2. მინიმუმ ერთი აქტიური `partner_location` არ არსებობს (pickup-ისთვის სავალდებულო);
3. matching-ის ambiguity-ები არ გადაწყდა;
4. კრიტიკული fitment conflict-ები არ დაიხურა.

პარტნიორის dashboard-ზე ეს ოთხი ნაბიჯი ჩანს checklist-ად, მიმდინარე ბლოკერის
მითითებით — არა უბრალოდ „pending“.
