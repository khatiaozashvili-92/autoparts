# 08 — Payment, Pricing & Settlement

> წყარო: PRD §31–33, §36, §44, §51–53, §64, §66–67.
> **მთავარი გადაწყვეტილება:** [ADR-001](00-index-and-decisions.md) — §32 იმარჯვებს §44-ზე.

---

## 1. ფულის მოდელი

```
Partner Base Price        500.00 ₾     ← პარტნიორი ადგენს
+ Platform Markup   10%    50.00 ₾     ← პლატფორმა ამატებს (§32)
────────────────────────────────
= Customer Price          550.00 ₾     ← მომხმარებელი ხედავს და იხდის
```

**ერთი ტრანზაქცია, არა ორი:**
```
Customer ──550₾──▶ Platform (merchant of record)
                       │
                       ├── 50₾  → Platform revenue (commission)
                       └── 500₾ → Partner settlement
```

§44-ის ფრაზა „Customer payment → Partner, Platform იღებს commission-ს ცალკე“
აღწერს **ეკონომიკურ** შედეგს (პარტნიორი იღებს სრულ base price-ს), არა ტრანზაქციების
რაოდენობას. ამას ადასტურებს data model: `Offer` სამივე ველს ინახავს (§64),
`Payment` ერთ `amount`-ს და `commission`-ს (§67), და `Settlement` ცალკე entity-ა (§62).

> **ბიზნეს-რისკი, რომელიც უნდა გაიზომოს:** markup მყიდველზეა, ანუ პლატფორმის ფასი
> იმავე მაღაზიის ფასზე ძვირია → showrooming (იპოვა აპში, დარეკა მაღაზიაში).
> საზომი: `Offer→Purchase Rate` (§61). თუ დაბალია, markup-ის გამყიდველზე გადატანა
> **schema-ს ცვლილებას არ საჭიროებს** — მხოლოდ `price_rules`-ის და DTO-ს ცვლილებას.

---

## 2. ვინ რას ხედავს

| ველი | Customer | Partner | Admin |
|------|:--------:|:-------:|:-----:|
| `base_price_minor` | ❌ | ✅ | ✅ |
| `platform_markup_minor` | ❌ | ❌ | ✅ |
| `customer_price_minor` | ✅ | ✅ | ✅ |
| სხვა პარტნიორის ნებისმიერი ფასი | ❌ | ❌ | ✅ |

`base_price` და `platform_markup` **customer DTO-ში საერთოდ არ არსებობს** — ვერც
შემთხვევით გაჟონავს. პარტნიორი ხედავს საკუთარ base-ს და customer price-ს (რომ იცოდეს
რა ფასად იყიდება), მაგრამ **არა markup-ის პროცენტს** — ის კომერციული ხელშეკრულების
ნაწილია და admin-ის კონტროლშია.

---

## 3. Markup Engine (§33)

```sql
-- price_rules: partner-specific, category-specific, ან ორივე
-- უფრო სპეციფიკური მოგებს (priority)
```

```ts
function resolveMarkup(offer: Offer, product: Product): Markup {
  const rules = activeRules
    .filter(r => (!r.partnerId  || r.partnerId  === offer.partnerId)
              && (!r.categoryId || r.categoryId === product.categoryId))
    .sort((a, b) =>
      specificity(b) - specificity(a) ||   // partner+category > partner > category
      b.priority - a.priority);
  return rules[0] ?? DEFAULT_MARKUP;
}
// specificity: partner+category=3, partner=2, category=1
```

მაგალითი (§33):

| პარტნიორი | კატეგორია | Markup |
|-----------|-----------|--------|
| A | Brake Parts | 8% |
| A | Electronics | 12% |
| A | * | 10% |
| * | * | 10% (default) |

**Markup-ის ცვლილება მოქმედებს მხოლოდ ახალ offer-ებზე და ხელახლა გათვლაზე.**
უკვე შექმნილი შეკვეთის `order_items.markup_minor` **არასოდეს იცვლება** —
ფასი ფიქსირდება ყიდვის მომენტში.

ყოველი ცვლილება → `audit_logs` (`COMMISSION_CHANGE`, §79).

---

## 4. Checkout flow

```
[1] Cart — fitment gate (R1, Invariant I5)
     ↓
[2] POST /checkout/reserve
     ├── real-time stock check (R2) — [06 §8](06-inventory-integration.md)
     ├── Redis lock + SELECT FOR UPDATE
     ├── reservations INSERT, expires_at = now + 15min
     └── totals-ის გათვლა (markup ფიქსირდება)
     ↓
[3] POST /checkout/confirm
     ├── orders + partner_orders + order_items (ტრანზაქციაში)
     ├── payments (status = PENDING, idempotency_key)
     └── payment intent provider-იდან
     ↓
[4] მომხმარებელი იხდის (provider-ის მხარეს — PCI scope ჩვენთან არ არის)
     ↓
[5] Webhook: AUTHORIZED
     ↓
[6] **Final stock validation** ← ბოლო შანსი
     ├── OK    → capture → PAID → CONFIRMED → reservations = CONSUMED
     └── FAIL  → void/refund → order = FAILED → §7
     ↓
[7] Partner notification (Dashboard + SMS) — §47
     ↓
[8] ავტომატური CONFIRMED — პარტნიორის ხელით დადასტურება არ სჭირდება (§47)
```

**[6] კრიტიკულია.** Reservation 15 წუთია, გადახდას შეიძლება 3 წუთი დასჭირდეს,
და ამ დროში პარტნიორის ERP-ში მარაგი შეიძლება გაიყიდოს ფიზიკურ მაღაზიაში.
§29-ის მოთხოვნა სწორედ ამაზეა.

**Reservation-ის ვადის გასვლა checkout-ის დროს:** თუ [3]–[5]-ს შორის
`expires_at` გავიდა → `410 RESERVATION_EXPIRED`, მომხმარებელი ბრუნდება offer-ზე.
გადახდა არ იწყება.

---

## 5. Payment Provider Abstraction (§44)

**კონკრეტული Georgian payment provider hardcoded არ არის.**

```ts
export interface PaymentProvider {
  readonly name: string;
  createIntent(o: PaymentIntentRequest): Promise<PaymentIntent>;
  capture(transactionId: string, amount: Money): Promise<CaptureResult>;
  void(transactionId: string): Promise<VoidResult>;
  refund(transactionId: string, amount: Money, key: string): Promise<RefundResult>;
  verifyWebhook(headers: Headers, rawBody: Buffer): WebhookEvent;
  capabilities(): {
    splitSettlement: boolean;      // acquirer თვითონ ყოფს თუ ჩვენ?
    partialRefund: boolean;
    applePay: boolean;
    googlePay: boolean;
    currencies: string[];
  };
}
```

იმპლემენტაციები: `MockPaymentProvider` (Step 1–8, ტესტები) → `AcquirerAdapter`
(Step 9, რეალური ბანკი).

### 5.1 ორი settlement მოდელი

`capabilities().splitSettlement`-ის მიხედვით:

| `splitSettlement` | როგორ მუშაობს |
|-------------------|---------------|
| `true` | acquirer თვითონ რიცხავს 500₾-ს პარტნიორს, 50₾-ს ჩვენ. `settlements` მხოლოდ ჩანაწერია |
| `false` | ჩვენ ვიღებთ 550₾-ს, `settlements` job პერიოდულად რიცხავს პარტნიორებს |

**კოდი ორივეს იტანს** — განსხვავება მხოლოდ `SettlementService`-ის რეჟიმშია.
ეს განზრახია: რომელი ბანკი რას შემოგვთავაზებს, ჯერ არ ვიცით ([00 §ღია საკითხები](00-index-and-decisions.md)).

---

## 6. Cancellation & Refund (§51–52)

| სცენარი | დასაშვები? | Refund |
|---------|:----------:|--------|
| `status < READY_FOR_PICKUP`, customer cancel | ✅ | ავტომატური, სრული |
| `status >= READY_FOR_PICKUP`, customer cancel | ❌ | — |
| No-show 24სთ (§52) | ავტომატური | სრული |
| Stock failure გადახდის შემდეგ (§30) | ავტომატური | სრული |
| Admin cancel | ✅ ნებისმიერ ეტაპზე | სრული ან ნაწილობრივი |

```ts
function canCustomerCancel(o: Order): boolean {
  return ['STOCK_RESERVED','AWAITING_PAYMENT','PAID','CONFIRMED','PREPARING']
         .includes(o.status);
}
```

### 6.1 No-show timer (§52, §93)

```
READY_FOR_PICKUP  → ready_for_pickup_at = now()
                  → pickup_deadline     = now() + 24h
                  → BullMQ delayed job @ pickup_deadline
       ↓ 24 საათი, დადასტურების გარეშე
Auto-cancel → სრული refund → notification ორივე მხარეს
```
ინახება (§52): `ready_for_pickup_at`, `pickup_deadline`, `cancelled_at`, refund ტრანზაქცია.

**შენიშვნა პარტნიორზე:** no-show პარტნიორის ბრალი არ არის, მაგრამ მან უკვე მოამზადა
ნაწილი. ეს არ ითვლება პარტნიორის `stock_reliability`-ში (განსხვავებით stock failure-ისგან).
საკომისიოს დაკავება no-show-ზე MVP-ში **არ ხდება** — ეს კომერციული გადაწყვეტილებაა,
რომელიც პარტნიორთან ხელშეკრულებაში უნდა გაიწეროს.

### 6.2 Idempotency

ყოველ refund-ს აქვს `idempotency_key`. ორმაგი refund = რეალური ფულის დაკარგვა,
ამიტომ:
- `refunds.idempotency_key` — `UNIQUE`;
- `Σ refunds.amount <= payments.amount` — Invariant I4, აღსრულდება ტრანზაქციაში;
- provider-ს key გადაეცემა, თუ ის მას იღებს.

---

## 7. Stock failure გადახდის შემდეგ (§30, §91)

```
PAID → final stock check → UNAVAILABLE
   ↓
refund (reason = STOCK_FAILURE, ავტომატური, სრული)
   ↓
order.status = FAILED
   ↓
notification: „სამწუხაროდ, ნაწილი გაიყიდა. თანხა სრულად დაგიბრუნდათ.“
   ↓
partner.stock_reliability ↓
```
**პროდუქტის ჩანაცვლება არ ხდება (§30)** — არც ავტომატურად, არც „მსგავსით“.

---

## 8. Returns (§53)

```
Platform minimum rules  ∪  Partner-specific conditions
```
Return policy არსებობს სამ დონეზე: პროდუქტი · პარტნიორი · პლატფორმა.
უფრო სპეციფიკური **ავსებს**, არ ცვლის პლატფორმის მინიმუმს.

```sql
CREATE TABLE return_policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL,           -- PLATFORM | PARTNER | PRODUCT
  partner_id  uuid REFERENCES partners(id),
  product_id  uuid REFERENCES products(id),
  window_days int  NOT NULL,
  conditions_key text NOT NULL,        -- i18n key, არა raw ტექსტი
  version     int  NOT NULL DEFAULT 1,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**ყიდვამდე მომხმარებელმა აუცილებლად უნდა ნახოს პირობები (§53).**
ამიტომ `orders` ინახავს `return_policy_version`-ს — რომელ ვერსიას დაეთანხმა.
პოლიტიკის მომავალი ცვლილება **უკვე შესრულებულ შეკვეთებს არ ეხება.**

---

## 9. იურიდიული წინაპირობა

Merchant of record-ის მოდელი (§1) ნიშნავს, რომ პლატფორმა იღებს მომხმარებლის ფულს
და პარტნიორს ურიცხავს. საქართველოში ამას სჭირდება:

1. იურიდიული პირი;
2. acquiring ხელშეკრულება ბანკთან (BOG / TBC / სხვა) — **split settlement-ის
   მხარდაჭერით ან მის გარეშე** (§5.1 ორივეს იტანს);
3. პარტნიორებთან ხელშეკრულება, სადაც გაწერილია markup, settlement-ის პერიოდი,
   refund-ის პასუხისმგებლობა და no-show-ის წესი;
4. საგადასახადო რეჟიმის დაზუსტება — ვინ არის მიმწოდებელი ინვოისზე.

**ეს ღია საკითხია და ტექნიკურად არ იხურება** ([00](00-index-and-decisions.md)).
Step 1–8 `MockPaymentProvider`-ით სრულად შესრულდება; Step 9-ის **რეალურ** რეჟიმში
გაშვება ამ ოთხის გარეშე შეუძლებელია.

---

## 10. Reconciliation

ღამის job:

| შემოწმება | მოქმედება შეუსაბამობისას |
|-----------|--------------------------|
| `Σ payments.captured` = provider-ის settlement report | Admin alert + `reconciliation_issues` |
| `settlements.net = gross − commission` | DB CHECK — არასოდეს უნდა ჩავარდეს |
| `Σ refunds ≤ payments.amount` order-ზე | Admin alert |
| ჩამოკიდებული `AUTHORIZED` > 24სთ | ავტომატური void |
| `ACTIVE` reservation ვადაგასული > 1სთ | ავტომატური `EXPIRED` + alert (job-ის ჩავარდნა) |

შედეგი ჩანს Admin → Finance-ში ([09](09-admin-panel.md)).
