# 09 — Admin Panel

> წყარო: PRD §59, §79. აპლიკაცია: `apps/admin` (Next.js). წვდომა: `PLATFORM_ADMIN`+.

---

## 1. დანიშნულება

Admin Panel არის ის ადგილი, სადაც **პლატფორმის ავტომატიკა ადამიანს ხვდება**.
მისი სამი კრიტიკული ფუნქციაა:

1. **Fitment conflict-ების გადაწყვეტა** — ამის გარეშე R1 ბლოკავს პროდუქტებს სამუდამოდ;
2. **პარტნიორების დაშვება** — ამის გარეშე marketplace ცარიელია;
3. **ფინანსური კონტროლი** — markup, refund, settlement.

დანარჩენი სექციები მნიშვნელოვანია, მაგრამ ამ სამის გარეშე პლატფორმა **არ მუშაობს**.

---

## 2. Navigation

```
Dashboard
Users
Vehicles
Partners
Products      ├ Master Parts · Brands · Products · Offers · Categories
Fitment       ├ Conflicts ⚠ · Rules · Manual Mappings
Inventory     ├ Syncs · Errors · Stock status
Orders        ├ All · Payments · Refunds · Audit
Requests      ├ Request Part · Partner responses         (P1)
Finance       ├ Commission · Markup · Settlement · Refunds · Reconciliation
Analytics     ├ Funnel · KPIs · Partners
Audit Logs
```

---

## 3. Fitment → Conflicts ⚠ (ყველაზე მნიშვნელოვანი ეკრანი)

```
┌──────────────────────────────────────────────────────────────┐
│ ღია კონფლიქტები (12)                        [დალაგება ▾]     │
├──────────────────────────────────────────────────────────────┤
│ Bosch 0986424815 — Front Brake Pads                          │
│ მანქანა: BMW 228i · 2016 · F22 · N20B20 · US                 │
│                                                              │
│ პარტნიორი „Auto Motors“ ამბობს:  COMPATIBLE                  │
│ Provider „nhtsa_vpic“ ამბობს:    NOT_COMPATIBLE              │
│ მიზეზი: engine_code არ ემთხვევა (N20B20 ≠ N26B20)            │
│                                                              │
│ ⚠ პროდუქტი ამჟამად დამალულია მომხმარებლებისგან.              │
│ გავლენა: 3 პროდუქტი · ~40 ძებნა/კვირაში                      │
│                                                              │
│ [Approve]  [Reject]  [Manual Map]  [Investigate]             │
└──────────────────────────────────────────────────────────────┘
```

| ღილაკი | შედეგი |
|--------|--------|
| `Approve` | `ADMIN_MANUAL` fitment `COMPATIBLE`-ით → პროდუქტი ჩნდება |
| `Reject` | პარტნიორის fitment → `active = false` → პროდუქტი რჩება დამალული |
| `Manual Map` | ფორმა ზუსტი კრიტერიუმებით (year range, engine code, market) |
| `Investigate` | რჩება `OPEN`, ემატება note და assignee |

**რატომ ჩანს „გავლენა“:** კონფლიქტების რიგი გრძელი იქნება. ადმინს სჭირდება იცოდეს
რომელი ბლოკავს რეალურ ძებნას და რომელი ეხება პროდუქტს, რომელსაც არავინ ეძებს.
ამის გარეშე რიგი პრიორიტეტის გარეშე მუშავდება.

ყოველი მოქმედება → `audit_logs` (`FITMENT_CHANGE`) `created_by`-ით.

---

## 4. Partners

### 4.1 Approval queue
```
Toyota Center  ·  PENDING  ·  განაცხადი 2 დღის წინ
  ✅ იურიდიული სახელი + საიდენტიფიკაციო
  ✅ 2 ფილიალი (თბილისი)
  ⚠ 0 პროდუქტი ატვირთული
  ⚠ საკონტაქტო ტელეფონი დაუდასტურებელი
  [Approve] [Reject] [Request info]
```

### 4.2 Partner detail
Profile · Locations · Integration (mode, API key, sync health) · Products · Offers ·
Orders · **Commission** (partner-specific `price_rules`) · **Stock Reliability** (ტრენდი) ·
Suspend/Reinstate.

**Suspend-ის შედეგი:** offers დაუყოვნებლივ ქრება ძებნიდან; **მიმდინარე შეკვეთები
გრძელდება** — მათი გაუქმება ცალკე, ცნობიერი მოქმედებაა.

---

## 5. Orders, Payments, Refunds

| ეკრანი | შესაძლებლობები |
|--------|----------------|
| All orders | ფილტრი სტატუსით/პარტნიორით/თარიღით; ძებნა order number-ით |
| Order detail | სრული timeline, fitment verdict ყიდვის მომენტში, payment, პარტნიორი |
| Payments | ტრანზაქციები, provider ID, სტატუსი |
| Refunds | ხელით refund ინიცირება (სრული/ნაწილობრივი), მიზეზით |
| Disputes | fitment-ის საჩივარი → აბრუნებს `fitment_checks.was_correct = false` |

**Dispute-ის მექანიზმი ორმაგ სამსახურს ასრულებს:** აგვარებს კონკრეტულ საჩივარს **და**
კვებავს KPI „Fitment Accuracy“-ს ([05 §10](05-fitment-engine.md)). ადმინი, რომელიც
საჩივარს ხურავს, ავტომატურად აუმჯობესებს ძრავის golden set-ს.

---

## 6. Analytics

### 6.1 Funnel (§60)
```
Registered          12,430
  ↓ 61%
Added Vehicle        7,582
  ↓ 44%
Searched Part        3,336
  ↓ 71%
Found Compatible     2,368   ⚠ 29% ცარიელი შედეგი → Request Part-ის სიგნალი
  ↓ 82%
Viewed Offers        1,942
  ↓ 38%
Selected Seller        738
  ↓ 64%
Checkout               472
  ↓ 91%
Paid                   430
  ↓ 94%
Completed              404
```
თითოეულ ბიჯზე: click-through რომელი ნაბიჯიც ცვივა → ვინ ცვივა (vehicle, კატეგორია,
პარტნიორი).

### 6.2 KPI ბარათები (§61)
Vehicle Activation · Search-to-Offer · Offer-to-Purchase ·
**Fitment Accuracy** · **Inventory Accuracy** · GMV · Take Rate ·
Order Success · Refund Rate.

**Fitment Accuracy და Inventory Accuracy ყოველთვის პირველ რიგშია** — ისინი
პროდუქტის პრიორიტეტების #1 და #2-ია (§ბოლო).

### 6.3 Partner performance
Inventory size · sync health · orders · revenue · cancellation rate ·
**stock reliability** · საშუალო ready-for-pickup დრო.

---

## 7. Finance

| სექცია | შინაარსი |
|--------|----------|
| Commission | მიმდინარე `price_rules`, ისტორია, ვისმა შეცვალა (§79) |
| Markup editor | partner × category მატრიცა, ცვლილების preview |
| Settlement | პერიოდები, gross/commission/net, სტატუსი, ექსპორტი |
| Refunds | ყველა refund მიზეზების ჭრილში |
| Reconciliation | [08 §10](08-payment-flow.md)-ის შეუსაბამობები |

**Markup-ის შეცვლისას ჩანს preview:** „ეს ცვლილება შეეხება 1,240 აქტიურ offer-ს;
საშუალო customer price გაიზრდება 2.1%-ით.“ ცვლილება რეალურ ფასებზე მოქმედებს და
უნდა იყოს ცნობიერი, არა შემთხვევითი.

---

## 8. Audit Logs (§79)

ფილტრები: actor · action · entity · partner · თარიღი.
ჩანაწერი აჩვენებს `before`/`after` diff-ს.

**Append-only** — UI-ში არ არსებობს წაშლის ან რედაქტირების ღილაკი, და DB role-საც
არ აქვს `UPDATE`/`DELETE` უფლება ([07 §8](07-authentication.md)).

---

## 9. უსაფრთხოება

| წესი |
|------|
| `PLATFORM_SUPPORT` — read-only + refund-ის ინიცირება; **markup-ს ვერ ცვლის** |
| `PLATFORM_ADMIN` — სრული marketplace; **როლებს ვერ ანიჭებს** |
| `SUPER_ADMIN` — როლები + სისტემური კონფიგურაცია |
| ყველა mutating action → `audit_logs` |
| სესია: 8 საათი, idle timeout 30 წუთი |
| MFA სავალდებულოა `PLATFORM_ADMIN`+ როლებზე |
