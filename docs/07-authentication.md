# 07 — Authentication, Authorization & Security

> წყარო: PRD §7, §76–77.

---

## 1. Authentication მეთოდები (§7)

| მეთოდი | MVP | შენიშვნა |
|--------|-----|----------|
| Email + password | ✅ | |
| Phone + password | ✅ | E.164 ნორმალიზაცია |
| OTP | ✅ | login, ვერიფიკაცია, პაროლის აღდგენა |
| Social (Google / Apple) | არქიტექტურულად მზად | `auth_identities` ცხრილი P0-ზე, UI P1 |

```sql
CREATE TABLE auth_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    text NOT NULL,              -- 'google' | 'apple'
  provider_uid text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
```
> ცხრილი P0-ზე იქმნება იმავე მიზეზით, რაც [ADR-002](00-index-and-decisions.md)-ში:
> ცოცხალ `users` ცხრილზე მიგრაცია მოგვიანებით ძვირია.

---

## 2. პაროლები

| პარამეტრი | მნიშვნელობა |
|-----------|-------------|
| ჰეშირება | **Argon2id** (`m=19MiB, t=2, p=1`) |
| მინიმალური სიგრძე | 10 სიმბოლო |
| გავრცელებული პაროლების სია | ✅ უარყოფა |
| Rehash | login-ზე, თუ პარამეტრები შეიცვალა |

bcrypt არ გამოიყენება — Argon2id არის მიმდინარე რეკომენდაცია GPU-ზე გატეხვის წინააღმდეგ.

---

## 3. Tokens

| Token | სიცოცხლე | შენახვა |
|-------|----------|---------|
| Access (JWT) | **15 წუთი** | მეხსიერებაში (web) / Keychain-Keystore (mobile) |
| Refresh | **30 დღე**, rotating | httpOnly Secure SameSite=Strict cookie (web) / secure storage (mobile) |

**Refresh rotation + reuse detection:** ყოველი refresh ქმნის ახალს და აუქმებს ძველს.
**გამოყენებული** refresh token-ის ხელახლა მოსვლა → მოწყობილობის ყველა token-ის გაუქმება
+ security notification. ეს ნიშნავს, რომ მოპარული token-ი ერთჯერადია.

JWT payload:
```json
{ "sub":"user-uuid", "roles":["CUSTOMER"], "partnerId":null,
  "jti":"…", "iat":…, "exp":… }
```
JWT **არასოდეს** შეიცავს: email, phone, სახელს, VIN-ს. მხოლოდ იდენტიფიკატორებს.

---

## 4. OTP

| პარამეტრი | მნიშვნელობა |
|-----------|-------------|
| სიგრძე | 6 ციფრი, CSPRNG |
| სიცოცხლე | 5 წუთი |
| მცდელობები | 5, შემდეგ კოდი იწვება |
| Rate limit | 3 / 15 წუთი destination-ზე |
| შენახვა | **მხოლოდ hash** (`otp_codes.code_hash`) |

ვერიფიკაციის პასუხი ერთნაირია არასწორი კოდისა და არარსებული destination-ისთვის —
enumeration-ის თავიდან ასაცილებლად.

---

## 5. RBAC (§77)

| როლი | Scope |
|------|-------|
| `CUSTOMER` | **მხოლოდ საკუთარი** vehicles, cart, orders, reviews |
| `PARTNER_USER` | **მხოლოდ საკუთარი partner-ის** products, offers, inventory, orders |
| `PARTNER_ADMIN` | + partner-ის მომხმარებლები, ფილიალები, ინტეგრაცია |
| `PLATFORM_SUPPORT` | read-only ყველაფერზე + refund-ის ინიცირება |
| `PLATFORM_ADMIN` | სრული marketplace-ის მართვა |
| `SUPER_ADMIN` | + როლების მინიჭება, სისტემური კონფიგურაცია |

### 5.1 Partner isolation — ყველაზე მნიშვნელოვანი წესი

> **პარტნიორი არ ხედავს სხვა პარტნიორების ფასებს** (§3, §31).

ეს **არ არის UI-ს გადაწყვეტილება.** ის აღსრულდება მონაცემთა წვდომის დონეზე:

```ts
@Injectable()
export class OfferRepository {
  async find(filter: OfferFilter, ctx: RequestContext) {
    const scope = ctx.hasRole('PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'SUPER_ADMIN')
      ? {}
      : { partnerId: ctx.requirePartnerId() };   // ტოკენიდან, არა request body-დან
    return this.db.offers.findMany({ where: { ...filter, ...scope } });
  }
}
```

სამი დამატებითი გარანტია:
1. `partnerId` **ყოველთვის** ტოკენიდან მოდის; request-ში მოსული `partnerId` იგნორირდება;
2. სხვისი რესურსი აბრუნებს **404**-ს, არა 403-ს — არსებობის ფაქტიც ინფორმაციაა;
3. `base_price` და `platform_markup` customer API-ის DTO-ში **არ არსებობს**
   ([08 §2](08-payment-flow.md)) — ანუ ვერც შემთხვევით გაჟონავს.

**ტესტი, რომელიც CI-ზე გადის:** partner A-ს ტოკენით partner B-ს ყველა რესურსზე
მიმართვა — ყველა უნდა აბრუნებდეს 404-ს.

---

## 6. უსაფრთხოების მოთხოვნები (§76)

| მოთხოვნა | იმპლემენტაცია |
|----------|---------------|
| HTTPS | TLS 1.3, HSTS `max-age=31536000; includeSubDomains; preload` |
| Encryption in transit | ყველგან, შიდა სერვისებს შორისაც |
| Password hashing | Argon2id (§2) |
| Secure sessions | httpOnly + Secure + SameSite=Strict |
| JWT expiration | 15 წუთი + rotation |
| RBAC | §5 |
| API authentication | JWT (app) / API key + HMAC (partner ERP) |
| Rate limiting | [04 §10](04-api-specification.md) |
| Audit logging | §79 → `audit_logs` |
| Payment data | **არ ინახება** — მხოლოდ `provider_transaction_id`; PCI scope გატანილია |
| VIN არ არის საჯარო | §7 ქვემოთ |

### 6.1 Partner ERP authentication

```
X-Partner-Key: pk_live_…
X-Timestamp:   1789…
X-Signature:   sha256=HMAC(secret, timestamp + '.' + rawBody)
```
- key ინახება hash-ად; plaintext ჩანს **მხოლოდ ერთხელ** შექმნისას;
- `timestamp` ±5 წუთის ფანჯარა → replay-ის დაცვა;
- rotation: ორი აქტიური key ერთდროულად, overlap პერიოდით.

### 6.2 Brute-force დაცვა

| ვექტორი | ზომა |
|---------|------|
| Login | 5 წარუმატებელი → 15 წუთი ბლოკი (account + IP ცალ-ცალკე) |
| OTP | 5 მცდელობა → კოდი იწვება |
| Password reset | 3 / საათი / account |
| Enumeration | ერთნაირი პასუხი და **ერთნაირი დრო** არსებულ/არარსებულ account-ზე |

---

## 7. VIN და პერსონალური მონაცემები

**VIN არ არის მომხმარებლის ავთენტიფიკაციის ფაქტორი.** ის ავტომობილს იდენტიფიცირებს,
არა ადამიანს. ეს §61 (v1 PRD)-ის პირდაპირი მოთხოვნაა.

| წესი | იმპლემენტაცია |
|------|---------------|
| VIN არ ინახება plaintext-ად | `vins.vin_enc` — app-level encryption, KMS key |
| ძებნა plaintext-ის გარეშე | `vins.vin_hash` = SHA-256(upper(vin)) |
| VIN არ ბრუნდება სრულად | API აბრუნებს მხოლოდ masked-ს: `WBA**********2345` |
| VIN არ ჩანს საჯაროდ | არც შეკვეთაში, არც პარტნიორთან, არც კალათაში |
| პარტნიორი ხედავს მხოლოდ | make / model / year / engine — **VIN-ს არასოდეს** |
| VIN არ ხვდება ლოგებში | log redaction filter `packages/core/src/redact.ts` |

**პარტნიორს VIN არ სჭირდება.** მას ჭირდება, იცოდეს რომელი ნაწილი მოამზადოს —
ამას `order_items.product_snapshot` და fitment verdict აძლევს.

### 7.1 დაცული ველები

სახელი · გვარი · ტელეფონი · email · მისამართი · გადახდის ინფორმაცია · VIN.

- ლოგებში redaction-ი სავალდებულოა;
- analytics-ში მხოლოდ აგრეგატები, არა PII;
- მონაცემთა ექსპორტი/წაშლა — self-service მოთხოვნა `/api/v1/account/data` და
  `/api/v1/account/delete` (შეკვეთების ისტორია ანონიმიზდება, არ იშლება — ფინანსური
  ჩანაწერი საჭიროა).

---

## 8. Audit Log (§79)

**სავალდებულოდ ლოგდება:** price change · stock change · fitment change ·
order status change · refund · partner action · admin action · commission change.

```ts
@Audited({ action: 'PRICE_CHANGE', entity: 'offer' })
async updateOfferPrice(offerId: string, priceMinor: bigint, ctx: RequestContext) { … }
```
დეკორატორი წერს `before`/`after` snapshot-ს, `actor_id`-ს, `ip`-ს, `user_agent`-ს.

`audit_logs` არის **append-only**: `UPDATE`/`DELETE` აკრძალულია DB role-ის დონეზე.

---

## 9. Secrets

| წესი |
|------|
| `.env` არასოდეს commit-დება; `.env.example` — მხოლოდ ცარიელი გასაღებებით |
| Production secrets — secret manager-ში, არა env ფაილში |
| Encryption key rotation — წელიწადში ერთხელ, re-encrypt job-ით |
| CI — secret scanning ყოველ PR-ზე; ნაპოვნის შემთხვევაში build ჩავარდება |

---

## 10. უსაფრთხოების ტესტები CI-ზე

| ტესტი | რას იცავს |
|-------|-----------|
| Partner isolation matrix | §5.1 — A ვერ ხედავს B-ს |
| Customer isolation | სხვისი order/vehicle/cart → 404 |
| VIN leak scan | არცერთი API response არ შეიცავს 17-სიმბოლოიან VIN pattern-ს |
| Rate limit | 429 ლიმიტის გადაჭარბებისას |
| Token reuse | გამოყენებული refresh → ყველა token უქმდება |
| Dependency audit | ცნობილი CVE-ები |
