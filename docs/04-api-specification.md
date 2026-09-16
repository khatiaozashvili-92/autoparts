# 04 — API Specification

> წყარო: PRD §68. ტრანსპორტი: REST/JSON over HTTPS. Base: `/api/v1`.
> OpenAPI 3.1 გენერირდება NestJS დეკორატორებიდან; `packages/api-client` — მისგან.

---

## 1. საერთო კონვენციები

### 1.1 Headers

| Header | სავალდებულო | დანიშნულება |
|--------|-------------|-------------|
| `Authorization: Bearer <jwt>` | დაცულ endpoint-ებზე | access token, TTL 15 წთ |
| `Accept-Language` | არა | `ka` \| `en` — default `ka` |
| `X-Currency` | არა | default partner/country-დან |
| `Idempotency-Key` | **ყველა mutating-ზე** | UUID; 24სთ ინახება |
| `X-Request-Id` | არა | tracing; თუ არაა — გენერირდება |

### 1.2 Error model

```json
{
  "error": {
    "code": "FITMENT_UNCERTAIN",
    "message": "Compatibility could not be confirmed for this vehicle.",
    "messageKey": "error.fitment.uncertain",
    "details": { "productId": "…", "vehicleId": "…", "missingAttributes": ["engine_code"] },
    "requestId": "01J…"
  }
}
```

`message` — დეველოპერისთვის (en). `messageKey` — **მომხმარებელს ეჩვენება**, i18n-ით (§80).
კლიენტი `message`-ს არასოდეს აჩვენებს.

| HTTP | როდის |
|------|-------|
| 400 | ვალიდაციის შეცდომა |
| 401 | ტოკენი არ არის / ვადაგასულია |
| 403 | როლი/scope არ იძლევა (მაგ. სხვისი partner-ის offer) |
| 404 | არ არსებობს **ან** არ ჩანს ამ scope-ში |
| 409 | კონფლიქტი: reservation დაკავებულია, order-ის სტატუსი შეიცვალა |
| 410 | reservation ვადაგასულია |
| 422 | ბიზნეს-წესი: fitment არ დასტურდება, stock არ არის |
| 429 | rate limit |
| 503 | provider მიუწვდომელია (retry-able) |

> 404-ის და 403-ის შერევა განზრახ არის იქ, სადაც არსებობის ფაქტიც ინფორმაციაა —
> პარტნიორმა არ უნდა გაიგოს სხვისი offer-ის არსებობა (§3, §31).

### 1.3 Pagination

Cursor-based ყველგან, სადაც სია შეიძლება გაიზარდოს:
```
GET /offers?cursor=eyJ…&limit=20
→ { "data": [...], "nextCursor": "eyJ…" | null }
```

---

## 2. Auth (`/auth`)

| Method | Path | აღწერა |
|--------|------|--------|
| POST | `/auth/otp/request` | `{phone}` → challenge + SMS |
| POST | `/auth/otp/verify` | `{challengeId, code}` → access + refresh |
| POST | `/auth/refresh` | refresh token rotation |
| POST | `/auth/logout` | refresh token-ის გაუქმება |
| GET | `/auth/me` | მიმდინარე user + roles |

`register`, `login` და `password/*` **აღარ არსებობს** —
[ADR-015](00-index-and-decisions.md). პაროლი პროდუქტს არ აქვს, ამიტომ არც
აღსადგენი რამ არის; ნომრის დაკარგვის შემთხვევა support-ის საკითხია და არა
endpoint-ის.

```http
POST /api/v1/auth/otp/request
{ "phone": "555 12 34 56" }

200 OK
{ "challengeId": "…", "expiresIn": 300, "resendAfter": 60,
  "maskedPhone": "••• •• •• 56" }
```

ნომერი ნებისმიერი ჩაწერით მიიღება და სერვერზე ნორმალიზდება. პასუხი **ერთნაირია**
არსებული და უცნობი ნომრისთვის — enumeration-ის თავიდან ასაცილებლად. development-ში
პასუხს ემატება `devCode` (§4.4 in [07](07-authentication.md)).

```http
POST /api/v1/auth/otp/verify
{ "challengeId": "…", "code": "481902", "firstName": "ნინო" }

200 OK
{ "userId": "…", "isNewUser": true,
  "accessToken": "…", "refreshToken": "…", "expiresIn": 900 }
```

`isNewUser` ეუბნება კლიენტს, ახლა შეიქმნა თუ არა ანგარიში — onboarding-ის
საჩვენებლად. `firstName` მხოლოდ მაშინ გამოიყენება, როცა `isNewUser` ჭეშმარიტია.

| შეცდომა | status | messageKey |
|---------|--------|------------|
| ნომერი მობილური არ არის | 400 | `error.auth.phoneInvalid` |
| ანგარიში დაბლოკილია | 403 | `error.auth.suspended` |
| კოდი არასწორი / ვადაგასული / დახარჯული | 401 | `error.otp.invalidCode` |
| ძალიან ადრე ითხოვს ხელახლა | 429 | `error.otp.resendTooSoon` |
| საათის ჭერი ამოწურა | 429 | `error.otp.tooManyRequests` |
| 5 მცდელობა გაასუფთავა | 429 | `error.otp.tooManyAttempts` |
| SMS gateway-მ არ მიიღო | 502 | `error.otp.deliveryFailed` |

დეტალები: [07](07-authentication.md).

---

## 3. Vehicles & VIN (`/vehicles`, `/vin`)

```http
POST /api/v1/vin/decode
{ "vin": "WBA1J5C50FV…" }
```
```json
200 {
  "configurationId": "…",
  "make": "BMW", "model": "2 Series", "modelYear": 2016,
  "generation": "F22", "engine": "2.0L Turbo", "engineCode": "N20B20",
  "fuelType": "PETROL", "transmission": "AUTOMATIC", "driveType": "RWD",
  "bodyType": "COUPE", "trim": "228i", "market": "US",
  "provider": "nhtsa_vpic",
  "clarifications": [
    { "id": "brake_config", "questionKey": "vin.clarify.brake_config",
      "options": [
        {"value":"STANDARD","labelKey":"brake.standard"},
        {"value":"M_SPORT","labelKey":"brake.m_sport"}
      ] }
  ]
}
```

`clarifications` არაცარიელია → §10-ის flow: მომხმარებელს ესმება დამაზუსტებელი კითხვა.
პასუხები მიდის `user_supplied_data`-ში, **არა** `verified_data`-ში.

| Method | Path | აღწერა |
|--------|------|--------|
| POST | `/vin/decode` | VIN → configuration (არ ინახავს გარაჟში) |
| POST | `/vehicles` | გარაჟში დამატება `{configurationId, customName, clarificationAnswers}` |
| GET | `/vehicles` | My Garage |
| GET | `/vehicles/:id` | დეტალები |
| PATCH | `/vehicles/:id` | `customName`, `isDefault`, clarification-ების განახლება |
| DELETE | `/vehicles/:id` | soft delete |

**VIN response-ში:** სრული VIN **არასოდეს** ბრუნდება. მხოლოდ maskedVIN
(`WBA…FV12345` → `WBA**********2345`). §76.

---

## 4. Catalog & Search (`/categories`, `/search`, `/products`)

| Method | Path | აღწერა |
|--------|------|--------|
| GET | `/categories` | ხე, locale-ით |
| GET | `/categories/:slug/parts` | master parts კატეგორიაში, `vehicleId`-ით ფილტრით |
| GET | `/search` | მთავარი ძებნა |
| GET | `/products/:id` | პროდუქტის გვერდი |
| GET | `/products/:id/fitment?vehicleId=` | ცალკე verdict |

```http
GET /api/v1/search?q=საქარე%20მინა&vehicleId=…&availability=IN_STOCK&sort=recommended
```
```json
{
  "vehicle": { "id":"…", "label":"BMW 228i 2016" },
  "interpreted": { "categorySlug":"body", "masterPartId":"…", "matchedBy":"SYNONYM_KA" },
  "data": [{
    "productId":"…", "name":"Windshield — BMW F22",
    "brand": {"name":"Pilkington","type":"AFTERMARKET"},
    "oem":"51317279769",
    "fitment": { "verdict":"EXACT", "confidence":0.98, "labelKey":"fitment.exact" },
    "offerSummary": {
      "count":3,
      "minPrice": {"amountMinor":42000,"currency":"GEL"},
      "bestAvailability":"IN_STOCK"
    }
  }],
  "nextCursor": null
}
```

**`vehicleId` სავალდებულოა** ძებნაში. მის გარეშე 400 — `VEHICLE_REQUIRED`.
ეს პირდაპირ R1-ის აღსრულებაა: არ არსებობს „ნაწილის ძებნა მანქანის გარეშე“.
(გზა B — §12 — კლიენტის მხარეს ჯერ vehicle-ს ითხოვს, მერე რეკავს.)

---

## 5. Offers (`/offers`)

```http
GET /api/v1/offers?productId=…&vehicleId=…&sort=cheapest
```
```json
{ "data": [{
  "offerId":"…",
  "partner": { "id":"…", "displayName":"Auto Motors", "rating":4.8 },
  "location": { "city":"თბილისი", "distanceKm":3.2 },
  "price": { "amountMinor":42000, "currency":"GEL" },
  "availability": "IN_STOCK",
  "availableQuantity": 4,
  "expectedAvailabilityDays": null,
  "paymentTerms": "FULL_PREPAYMENT",
  "warrantyMonths": 12,
  "stock": { "lastSyncedAt":"2026-09-15T12:03:00Z", "isStale":false, "ageMinutes":2 },
  "returnPolicyKey": "policy.partner.autoMotors.v3"
}]}
```

**`price.amountMinor` არის `customer_price` (base + markup).** `base_price` და
`platform_markup` customer API-ში **არასოდეს ჩანს** — ისინი მხოლოდ partner და admin
scope-შია. იხ. [08 §2](08-payment-flow.md).

**`stock.ageMinutes` ყოველთვის ბრუნდება** — UI ვალდებულია აჩვენოს „განახლდა X წუთის წინ“
(§73). ეს R2-ის ხილული ნაწილია.

`sort`: `recommended` (default) | `cheapest` | `nearest` | `best_rated` | `fastest`.

---

## 6. Cart, Reservation, Orders

| Method | Path | აღწერა |
|--------|------|--------|
| GET | `/cart` | მიმდინარე კალათა |
| POST | `/cart/items` | `{offerId, vehicleId, quantity}` — **fitment gate აქ მუშაობს** |
| PATCH | `/cart/items/:id` | quantity |
| DELETE | `/cart/items/:id` | |
| POST | `/checkout/reserve` | 15-წუთიანი reservation + real-time stock check |
| POST | `/checkout/confirm` | order-ის შექმნა + payment intent |
| GET | `/orders` | შეკვეთების ისტორია |
| GET | `/orders/:id` | დეტალები + `pickupCode` |
| POST | `/orders/:id/cancel` | დასაშვებია `< READY_FOR_PICKUP` (§51) |
| POST | `/orders/:id/confirm-receipt` | მომხმარებლის დადასტურება (§50) |

```http
POST /api/v1/cart/items
{ "offerId":"…", "vehicleId":"…", "quantity":1 }
```
```json
422 { "error": {
  "code":"FITMENT_NOT_CONFIRMED",
  "messageKey":"error.fitment.notConfirmed",
  "details": { "verdict":"UNCERTAIN", "missingAttributes":["brake_config"],
               "clarificationId":"brake_config" }
}}
```
> კალათაში დამატება **ხელახლა** ამოწმებს fitment-ს, არა მხოლოდ ძებნისას. მიზეზი: ძებნასა
> და დამატებას შორის fitment conflict შეიძლება გაიხსნას ან ადმინმა override გააკეთოს.
> Invariant I5.

```http
POST /api/v1/checkout/reserve
Idempotency-Key: 8f3c…
{ "cartId":"…" }
```
```json
201 {
  "reservationIds":["…"],
  "expiresAt":"2026-09-15T12:18:00Z",
  "totals": { "subtotalMinor":42000, "markupMinor":3360,
              "totalMinor":45360, "currency":"GEL" }
}
```
```json
409 { "error": { "code":"STOCK_UNAVAILABLE",
  "messageKey":"error.stock.unavailable",
  "details": { "offerId":"…", "requested":2, "available":1 } } }
```

---

## 7. Partner API (`/partner/*`)

ყველა endpoint **partner-scoped**: `partnerId` მოდის ტოკენიდან, არა path-იდან.
სხვისი რესურსი → 404.

| Method | Path | აღწერა |
|--------|------|--------|
| GET | `/partner/dashboard` | KPI ბარათები |
| GET/POST/PATCH | `/partner/locations` | ფილიალები |
| GET/POST/PATCH | `/partner/products` | პროდუქტები |
| GET/PATCH | `/partner/offers` | ფასი, მარაგი, availability |
| POST | `/partner/inventory/csv` | multipart upload → `syncId` |
| GET | `/partner/inventory/syncs/:id` | სტატუსი + row-level errors (§57) |
| GET | `/partner/orders` | შეკვეთები სტატუსებით |
| POST | `/partner/orders/:id/ready` | Mark as Ready for Pickup (§48) |
| POST | `/partner/orders/:id/verify-pickup` | QR კოდის ვერიფიკაცია |
| GET | `/partner/requests` | Request Part *(P1)* |
| POST | `/partner/requests/:id/offer` | Make Offer / Can't Fulfill *(P1)* |

### 7.1 Inbound Partner Integration API (§20 v1 / §24)

პარტნიორის ERP-ისთვის — **API key + HMAC**, არა JWT:

```http
POST /api/v1/integration/inventory
X-Partner-Key: pk_live_…
X-Signature: sha256=…
X-Timestamp: 1789…
{ "items": [
  { "sku":"BP-2211", "oem":"34116850568", "quantity":5,
    "priceMinor":42000, "currency":"GEL", "availability":"IN_STOCK" }
]}
```
```json
202 { "syncId":"…", "accepted":1, "rejected":0 }
```

| Method | Path | აღწერა |
|--------|------|--------|
| POST | `/integration/inventory` | batch upsert (მთავარი) |
| GET | `/integration/orders` | ახალი შეკვეთები polling-ით |
| POST | `/integration/orders/:id/status` | სტატუსის დაყენება |
| GET | `/integration/health` | ჩვენი მხრიდან ping |

**Outbound (ჩვენ → პარტნიორი), თუ პარტნიორს აქვს endpoint-ები:**
`GET /inventory`, `GET /products`, `GET /prices`, `GET /availability`,
`POST /orders` — adapter-ით. იხ. [06](06-inventory-integration.md).

---

## 8. Admin API (`/admin/*`)

მოითხოვს `PLATFORM_ADMIN` ან ზემოთ. ყოველი mutating action → `audit_logs` (§79).

| Method | Path | აღწერა |
|--------|------|--------|
| GET/PATCH | `/admin/users` | ნახვა, suspend, როლები |
| GET/PATCH | `/admin/partners` | approve, suspend, commission |
| GET/POST/PATCH | `/admin/categories`, `/admin/master-parts`, `/admin/products` | კატალოგი |
| GET | `/admin/fitment/conflicts` | ღია კონფლიქტები (§17) |
| POST | `/admin/fitment/conflicts/:id/resolve` | `{action: approve\|reject\|map, ...}` |
| POST | `/admin/fitment/mappings` | ხელით mapping (`ADMIN_MANUAL`) |
| GET/POST/PATCH | `/admin/price-rules` | markup (§33) |
| GET | `/admin/orders`, `/admin/payments` | კონტროლი |
| POST | `/admin/orders/:id/refund` | ხელით refund |
| GET | `/admin/settlements` | პარტნიორის ანგარიშსწორება |
| GET | `/admin/analytics/funnel` | §60 |
| GET | `/admin/audit-logs` | ფილტრებით |

---

## 9. Idempotency

`POST /checkout/reserve`, `/checkout/confirm`, `/orders/:id/cancel`,
`/admin/orders/:id/refund`, `/integration/inventory` — **ყველა მოითხოვს
`Idempotency-Key`-ს**.

ქცევა: იგივე key + იგივე body → **იგივე პასუხი**, ხელახლა შესრულების გარეშე.
იგივე key + სხვა body → `409 IDEMPOTENCY_KEY_REUSED`.
ინახება Redis-ში 24სთ + `payments.idempotency_key` / `refunds.idempotency_key` სამუდამოდ.

> ეს არ არის „nice to have“. მობილურ ქსელში retry ნორმაა, და ორმაგი reservation ან
> ორმაგი refund რეალური ფულის დაკარგვაა.

---

## 10. Rate limits

| Scope | ლიმიტი |
|-------|--------|
| `/auth/otp/request` **ნომერზე** | 1 / წუთი და 5 / საათი |
| `/auth/otp/verify` challenge-ზე | 5 მცდელობა, მერე იხურება |
| `/auth/otp/request` IP-ზე | 20 / წუთი — განზრახ ფართო, იხ. ქვემოთ |
| `/auth/otp/verify` IP-ზე | 15 / წუთი |
| `/vin/decode` user-ზე | 20 / საათი (provider ფულს ღირს) |
| `/search` user-ზე | 60 / წუთი |
| `/integration/*` partner key-ზე | 600 / წუთი |
| ზოგადი authenticated | 300 / წუთი |

გადაჭარბებისას `429` + `Retry-After`.

IP-ზე მიბმული ლიმიტი განზრახ ფართოა: ქართული ბაზრის დიდი ნაწილი ოპერატორის NAT-ის
უკნიდან შემოდის, და ერთ მისამართზე მკაცრი ზღვარი მთელ უბანს დაბლოკავდა. SMS-ის
ტუმბვისგან რეალურ დაცვას **ნომერზე** მიბმული ლიმიტი იძლევა.
