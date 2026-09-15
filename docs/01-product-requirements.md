# 01 — Product Requirements

> წყარო: PRD §1–6, §84–86, §88–95, §103–105. გადაწყვეტილებები: [ADR-001 … ADR-007](00-index-and-decisions.md).

---

## 1. პროდუქტის ბირთვი

```
VIN → Exact Vehicle → Part Search → Verified Fitment
    → Partner Offers → Price Comparison → Stock Validation
    → Payment → Pickup
```

ყველა სხვა ფუნქცია ამ ბირთვის **გარშემო** შენდება და **არ ართულებს** მას (§104).

### 1.1 სამი წესი, რომელიც არასოდეს ირღვევა (§97)

| # | წესი | სად აღსრულდება |
|---|------|----------------|
| R1 | არასოდეს ვაჩვენებთ პროდუქტს თავსებადად, თუ compatibility დადასტურებული არ არის | `FitmentEngine` — [05](05-fitment-engine.md) |
| R2 | არ ვაჩვენებთ „In Stock“-ს საბოლოო purchase validation-ის გარეშე | `InventoryService` — [06](06-inventory-integration.md) |
| R3 | Partner data არის **input**; platform Fitment Engine არის საბოლოო **authority** | `FitmentEngine` §16 პრიორიტეტი |

R1–R3 არის **acceptance gate**. თუ ცვლილება ამათგან რომელიმეს არღვევს, ის არ მერჯდება,
რაც არ უნდა კარგი იყოს დანარჩენი.

---

## 2. მომხმარებლის ტიპები და უფლებები (§6)

### 2.1 B2C Customer
რეგისტრაცია · ავტომობილის დამატება · VIN დეკოდირება · Garage-ის მართვა · ნაწილის ძებნა ·
შეთავაზებების შედარება · კალათა · გადახდა · შეკვეთის ნახვა · გაუქმება წესების ფარგლებში ·
მიღების დადასტურება · QR pickup confirmation.

### 2.2 B2B Partner
კომპანიის პროფილი · ფილიალები · პროდუქტების ატვირთვა · ფასების მართვა · მარაგის მართვა ·
API/CSV ინტეგრაცია · შეკვეთების მიღება · სტატუსის შეცვლა · Request Part-ზე პასუხი *(P1)*.

**პარტნიორი ვერ ხედავს სხვა პარტნიორების ფასებს** (§3, §31) — ეს არის
authorization-ის მოთხოვნა, არა UI-ს. აღსრულდება query-ის დონეზე: ყველა offer-ის
წაკითხვა partner-scoped-ია. იხ. [07 §5](07-authentication.md).

### 2.3 Admin
მომხმარებლები · პარტნიორები · პროდუქტები · კატეგორიები · fitment · კონფლიქტები ·
markup/საკომისიო · შეკვეთები · refund · Request Part · analytics · audit logs.

---

## 3. Scope

### 3.1 MVP — P0 (§84)

**Customer:** Registration/Login · VIN input · VIN decoding · Garage · Vehicle selection ·
Search · Categories · Fitment · Product catalog · Partner offers · Filters · Product details ·
Cart · **Single-partner checkout** · Online payment · Reservation · Order tracking · Pickup ·
QR confirmation · Cancellation · Automatic refund · 24-hour no-show cancellation.

**Partner:** Registration/onboarding · Dashboard · Products · Inventory · Price · Orders ·
Ready for Pickup · API · CSV · Manual management.

**Admin:** Users · Partners · Products · Fitment · Inventory · Orders · Payments · Refunds ·
Markup · Commission · Analytics · Audit logs.

### 3.2 P1 (§85)
Courier delivery · Delivery tracking · Reviews · Favorites · Advanced notifications ·
**Request Part** *(schema P0-ში — [ADR-002](00-index-and-decisions.md))* · Better CSV tools ·
Advanced partner integrations · Multi-vendor cart · Multi-partner payment · Seller ratings.

### 3.3 P2 (§86)
AI Search · Natural language search · Image-based part search · Maintenance reminders ·
Service marketplace · Mechanic booking · Used parts · Refurbished parts · Loyalty ·
Financing · International markets · Advanced recommendations.

### 3.4 MVP-ში ცალსახად **არ** შედის
- ❌ კურიერული მიწოდება — **მხოლოდ pickup** (§1, §48)
- ❌ Multi-partner checkout — ერთი checkout = ერთი პარტნიორი (§40)
- ❌ Used / Refurbished პროდუქტები — იყიდება მხოლოდ `NEW` (§22)
- ❌ Condition filter UI-ში (§22)
- ❌ Reviews / ratings (P1)

**მაგრამ data model-ი სამივეს ითვალისწინებს:** `PartnerOrder` (§41), `condition` enum (§22),
`delivery_method` (§1). ეს განზრახ არის — P1-ის ჩართვა migration-ს არ უნდა საჭიროებდეს.

---

## 4. Journeys

### 4.1 Customer (§98)
```
OPEN APP → REGISTER/LOGIN → ADD VEHICLE → ENTER VIN → VIN VALIDATION
→ VEHICLE IDENTIFIED → SAVE TO GARAGE → SEARCH PART → FITMENT ENGINE
→ COMPATIBLE PRODUCTS → COMPARE PARTNER OFFERS → SELECT OFFER → CHECK STOCK
→ 15-MIN RESERVATION → PAYMENT → ORDER CONFIRMED → PARTNER NOTIFIED
→ READY FOR PICKUP → CUSTOMER PICKS UP → QR/APP CONFIRMATION → COMPLETED
```

### 4.2 Partner (§99)
```
PARTNER REGISTRATION → ADMIN APPROVAL → PARTNER PROFILE → ADD LOCATION
→ CONNECT INVENTORY (API/CSV/DASHBOARD) → PRODUCT NORMALIZATION
→ FITMENT VALIDATION → OFFERS LIVE → CUSTOMER ORDER → PAYMENT CONFIRMED
→ PARTNER NOTIFIED → PREPARE PRODUCT → READY FOR PICKUP
→ CUSTOMER RECEIVES → ORDER COMPLETED
```

### 4.3 Search-ის ორი გზა (§12)
- **გზა A:** Garage → Select Vehicle → Search Part
- **გზა B:** Main Search → Search Part → Select Vehicle

თუ მომხმარებელს **ერთი** მანქანა აქვს, სისტემა ავტომატურად ირჩევს მას და vehicle
selection-ის ბიჯს ტოვებს.

---

## 5. Order lifecycle

### 5.1 Backend statuses (§45)
```
DRAFT → STOCK_RESERVED → AWAITING_PAYMENT → PAID → CONFIRMED
→ PREPARING → READY_FOR_PICKUP → PICKED_UP → COMPLETED
                                          ↘ CANCELLED → REFUNDED
```
სრული enum: [03 §8](03-database-schema.md).

### 5.2 Customer-facing ტექსტები (§46)
backend enum **არასოდეს** ჩანს UI-ში. mapping i18n key-ებით:

| Backend | i18n key | ქართული |
|---------|----------|---------|
| `CONFIRMED` | `order.status.received` | შეკვეთა მიღებულია |
| `PAID` | `order.status.paid` | გადახდა დადასტურებულია |
| `PREPARING` | `order.status.preparing` | შეკვეთა მზადდება |
| `READY_FOR_PICKUP` | `order.status.ready` | მზადაა ასაღებად |
| `READY_FOR_PICKUP` *(24სთ ტაიმერით)* | `order.status.awaiting_pickup` | ასაღებად გელოდებათ |
| `COMPLETED` | `order.status.completed` | შეკვეთა მიღებულია |
| `CANCELLED` | `order.status.cancelled` | შეკვეთა გაუქმებულია |
| `REFUNDED` | `order.status.refunded` | თანხა დაბრუნებულია |

### 5.3 Cancellation (§51–52, §92–93)

| სიტუაცია | დასაშვებია? | შედეგი |
|----------|-------------|--------|
| `status < READY_FOR_PICKUP` | ✅ Customer cancel | ავტომატური სრული refund |
| `status >= READY_FOR_PICKUP` | ❌ Customer cancel გამორთულია | — |
| `READY_FOR_PICKUP` + 24სთ გასული | ავტომატური | Auto-cancel + სრული refund |

ინახება: `ready_for_pickup_at`, `pickup_deadline`, `cancelled_at`, `refund` ტრანზაქცია (§52).

### 5.4 Stock failure გადახდის შემდეგ (§30, §91)
```
Payment captured → final stock check → UNAVAILABLE
→ Order FAILED → Automatic full refund → Customer notified
```
**პროდუქტის თვითნებური ჩანაცვლება არ ხდება** (§30).

---

## 6. Acceptance Criteria

### AC-VIN (§88)
```gherkin
Given მომხმარებელი შეიყვანს VIN-ს
When VIN არის სტრუქტურულად ვალიდური (სიგრძე, სიმბოლოები, checksum სადაც სტანდარტი იძლევა)
Then provider აბრუნებს vehicle configuration-ს
And vehicle ინახება Garage-ში
And verified data ჩანს მომხმარებელთან

Given VIN არასწორია
Then ჩნდება გასაგები error (არა stack trace, არა provider-ის raw პასუხი)

Given configuration გაურკვეველია (მაგ. 2 brake configuration)
Then ჩნდება დამატებითი დამაზუსტებელი კითხვა
And პასუხი ინახება user_supplied_data-ში (verified_data-სგან განცალკევებით)
```

### AC-SEARCH (§89)
```gherkin
Given მომხმარებელს არჩეული აქვს vehicle
When წერს ნაწილის სახელს (ka ან en, typo-თი ან OEM/SKU-თი)
Then სისტემა აბრუნებს შესაბამის პროდუქტებს
And არათავსებადი პროდუქტი შედეგებში არ არის
And UNCERTAIN fitment-ის პროდუქტი არ არის მონიშნული compatible-ად
And შეუძლია filtering და სხვადასხვა partner offer-ის ფასის შედარება
```

### AC-PURCHASE (§90)
```gherkin
Compatible Product → Offer → Stock Validation → Reservation → Payment
→ Order Confirmed → Partner Notification → Ready for Pickup
→ Customer Received → Completed
```

### AC-STOCK-FAILURE (§91)
```gherkin
Given გადახდა შესრულდა
When final stock validation აბრუნებს UNAVAILABLE
Then შეკვეთა ვერ სრულდება
And ხდება ავტომატური სრული refund
And მომხმარებელი იღებს მკაფიო შეტყობინებას
```

### AC-CANCEL (§92) / AC-NO-SHOW (§93)
იხ. §5.3 ზემოთ.

---

## 7. Data Quality Rules (§94)

სისტემამ **არ უნდა დაუშვას**. თითოეული აღსრულდება DB constraint-ით, არა მხოლოდ კოდით:

| წესი | აღსრულება |
|------|-----------|
| duplicate master products | `UNIQUE (category_id, normalized_name, position, axle)` |
| invalid OEM | `CHECK (oem ~ '^[A-Z0-9][A-Z0-9\-\.\/ ]{2,49}$')` + normalization |
| incompatible fitment | Fitment Engine verdict gate — [05](05-fitment-engine.md) |
| negative stock | `CHECK (stock_quantity >= 0)` |
| negative price | `CHECK (base_price_minor >= 0 AND platform_markup_minor >= 0)` |
| invalid currency | `CHECK (currency ~ '^[A-Z]{3}$')` + FK `currencies` |
| expired reservation | partial index + `expires_at` job — [08 §4](08-payment-flow.md) |
| unauthorized partner access | RLS-style scoping — [07 §5](07-authentication.md) |

---

## 8. KPIs (§61)

| KPI | ფორმულა | სამიზნე (MVP) |
|-----|---------|---------------|
| Vehicle Activation Rate | Added Vehicle / Registered | > 60% |
| Search-to-Offer Rate | Searches with ≥1 offer / Searches | > 40% |
| Offer-to-Purchase Rate | Purchases / Offer views | ბაზისური გაზომვა |
| **Fitment Accuracy** | Correct fitment / Total fitment checks | **> 98%** |
| **Inventory Accuracy** | Correct stock / Total stock checks | **> 95%** |
| GMV | Σ completed order totals | ბაზისური |
| Take Rate | Platform revenue / GMV | = markup %-ს |
| Order Success Rate | Completed / Paid | > 90% |
| Refund Rate | Refunded / Paid | < 5% |

**Fitment Accuracy და Inventory Accuracy არის ორი ყველაზე მნიშვნელოვანი რიცხვი.**
ისინი გაზომვადია მხოლოდ იმ შემთხვევაში, თუ ყოველი fitment verdict და ყოველი stock check
ლოგდება — იხ. `fitment_checks` და `inventory_checks` [03](03-database-schema.md)-ში.
ეს არ არის „nice to have“ ტელემეტრია; ამის გარეშე KPI #4 და #5 ვერ გაიზომება.

### 8.1 Funnel (§60)
```
Registered → Added Vehicle → Searched Part → Found Compatible Part
→ Viewed Offers → Selected Seller → Checkout → Paid → Completed
```
თითოეული ნაბიჯი ცალკე analytics event-ია. იხ. [09 §6](09-admin-panel.md).

---

## 9. Non-functional (§73, §95, §96)

| მოთხოვნა | სამიზნე |
|----------|---------|
| Search response | < 2–3 წმ (p95) |
| Product page | < 1 წმ (p95) |
| Partner API failure | marketplace **არ ჩერდება**; stale data მონიშნულია |
| Stale indicator | „Inventory last updated 12 minutes ago“ |
| Backups | PostgreSQL automated + PITR + **ტესტირებული** restore |
| Observability | structured logging; API/provider/sync/payment/fitment/search/order/refund errors |

**კრიტიკული მოთხოვნა (§96):** კრიტიკული მონაცემი არ უნდა იყოს დამოკიდებული მხოლოდ
ერთი external provider-ის API-ზე. ამიტომ decoded vehicle configuration **ჩვენს**
ბაზაშია, არა provider-ის ქეშში.

---

## 10. საბოლოო პრიორიტეტი

როცა development-ის დროს არჩევანი დგება, რიგი არის:

1. **Fitment Accuracy**
2. **Inventory Accuracy**
3. Search Speed
4. Checkout/Payment Reliability
5. Partner Experience
6. Customer UX
7. Advanced Features

> ფუნქცია არ ემატება იმიტომ, რომ „კარგად ჟღერს“, თუ ის არ აუმჯობესებს ზემოთ ჩამოთვლილ
> core პროცესს.
