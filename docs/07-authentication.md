# 07 — Authentication, Authorization & Security

> წყარო: PRD §7, §76–77.

---

## 1. Authentication მეთოდები (§7)

| მეთოდი | MVP | შენიშვნა |
|--------|-----|----------|
| **Phone + ერთჯერადი SMS კოდი** | ✅ | ერთადერთი გზა. E.164 ნორმალიზაცია |
| Email + password | ❌ | ამოღებულია — [ADR-015](00-index-and-decisions.md) |
| Phone + password | ❌ | ამოღებულია — [ADR-015](00-index-and-decisions.md) |
| Social (Google / Apple) | არქიტექტურულად მზად | `auth_identities` ცხრილი P0-ზე, UI P1 |

ნომერი **თავად არის ანგარიში**. რეგისტრაცია ცალკე ნაბიჯი არ არის: უცნობ ნომერზე
პირველივე დადასტურებული კოდი ქმნის მომხმარებელს `CUSTOMER` როლით. `email` ველი
რჩება, მაგრამ არჩევითია და შესვლაში არ მონაწილეობს.

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

## 2. პაროლები — არ არსებობს

პროდუქტს პაროლი **არ აქვს**. `users.password_hash` სვეტი წაშლილია
(`0008_phone_otp_auth.sql`), Argon2id დამოკიდებულება ამოღებულია, და
`/auth/login` / `/auth/register` endpoint-ები აღარ არსებობს.

მიზეზი [ADR-015](00-index-and-decisions.md)-შია: მომხმარებელი ისედაც ამტკიცებს
ნომრის ფლობას, შენახული პაროლი კი პასუხისმგებლობაა, რომლის გაჟონვაც სხვა
სერვისებსაც აზიანებს, რადგან ხალხი პაროლებს იმეორებს.

### 2.1 ნომრის ნორმალიზაცია

ნომერი ანგარიშის იდენტიფიკატორია, ამიტომ მისი **მხოლოდ ერთი ჩაწერა** შეიძლება
მოხვდეს ბაზაში. `+995 555 12 34 56`, `995555123456` და `555123456` ერთი
მომხმარებელია; სამად შენახვა ერთსა და იმავე ადამიანს სამ შეკვეთის ისტორიას
მისცემდა.

ერთადერთი იმპლემენტაცია — `normalizePhone` (`@autoparts/core`), იმავე წესით
რაც `normalizeIdentifier`-ს აქვს ([ADR-004](00-index-and-decisions.md)): API,
seed, ორივე კლიენტი და ტესტები მას იძახებენ და არა საკუთარ ასლს.

`isMobileNumber` ცალკე ამოწმებს, **შეიძლება თუ არა ნომერზე SMS-ის მისვლა** —
ქართული ფიქსირებული ხაზი (3XXXXXXXX) კარზევე უარყოფება, რადგან კოდის სიცარიელეში
გაგზავნა და შემდეგ მომხმარებლის დადანაშაულება უარესია, ვიდრე პირდაპირი უარი.

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

## 4. OTP — შესვლის ერთადერთი მექანიზმი

| პარამეტრი | მნიშვნელობა | env |
|-----------|-------------|-----|
| სიგრძე | 6 ციფრი, CSPRNG (`randomInt`) | |
| სიცოცხლე | 5 წუთი | `OTP_TTL_SECONDS` |
| მცდელობები | 5, შემდეგ challenge იწვება | `OTP_MAX_ATTEMPTS` |
| ხელახლა გაგზავნა | 60 წამი ნომერზე | `OTP_RESEND_COOLDOWN_SECONDS` |
| ჭერი | 5 კოდი საათში **ნომერზე** | `OTP_MAX_PER_HOUR` |
| შენახვა | **მხოლოდ HMAC** (`otp_challenges.code_hash`) | |

### 4.1 ორი ნაბიჯი

```
POST /auth/otp/request   { phone }
  → { challengeId, expiresIn, resendAfter, maskedPhone, devCode? }

POST /auth/otp/verify    { challengeId, code, firstName?, deviceId? }
  → { userId, isNewUser, accessToken, refreshToken, expiresIn }
```

ნომერი **challenge-იდან** მოდის და არა request body-დან. სხვაგვარად სწორი კოდის
მფლობელს სხვისი ნომრით ვერიფიკაცია შეეძლებოდა.

### 4.2 რატომ HMAC და არა უბრალო hash

`code_hash = HMAC-SHA256(JWT_SECRET, "ნომერი:კოდი")`. ნომრით keying-ს ორი
შედეგი აქვს: ერთი და იმავე ექვსი ციფრის მიმღები ორი მომხმარებელი ერთნაირ hash-ს
**არ** იზიარებს, და მოპარული ცხრილი მილიონი წინასწარ დათვლილი digest-ით ვერ
იხსნება.

### 4.3 რას ვიცავთ

| საფრთხე | პასუხი |
|---------|--------|
| კოდის გამოცნობა | 5 მცდელობა, შემდეგ challenge იხურება — არა უბრალოდ ვადის გასვლა |
| SMS-ის ტუმბვა | 1/წუთი + 5/საათი **ნომერზე** |
| ნომრების ჩამოთვლა | პასუხი იდენტურია არსებული და უცნობი ნომრისთვის |
| კოდის ხელახლა გამოყენება | `consumed_at` იწერება იმავე `UPDATE`-ში, რომელიც სისწორეს ამოწმებს |
| გაჩერებული challenge | უცნობი, დახარჯული და ვადაგასული — **ერთი და იგივე 401** |

IP-ზე მიბმული ლიმიტი განზრახ ფართოა (20/წუთი): ქართული ბაზრის დიდი ნაწილი
ოპერატორის NAT-ის უკნიდან შემოდის. რეალური დაცვა ნომერზეა, არა მისამართზე.

### 4.4 development

SMS gateway არც დეველოპერის მანქანაზეა და არც CI-ზე. `SMS_PROVIDER=console`
კოდს ლოგში წერს, `OTP_ECHO_CODE=true` კი მას პასუხში `devCode`-ად აბრუნებს —
ამის გარეშე ლოკალურად შესვლა შეუძლებელი იქნებოდა.

`loadConfig` **უარს ამბობს production-ში ორივეზე**: `NODE_ENV=production` +
`OTP_ECHO_CODE` ან `SMS_PROVIDER=console` → პროცესი არ იშვება.

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
| OTP code hashing | HMAC-SHA256, ნომრით keyed (§4.2) |
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
| OTP kod-ის მოთხოვნა | 1 / წუთი + 5 / საათი / **ნომერი** |
| OTP ვერიფიკაცია | 5 მცდელობა / challenge |
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
