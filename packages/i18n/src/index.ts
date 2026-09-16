/**
 * Translation keys (PRD §80).
 *
 * The API never returns rendered copy — it returns keys, and the client
 * resolves them. That is what lets a user switch language and see their whole
 * order history change with them, including notifications that were created
 * before the switch.
 *
 * Keys missing from a locale fall back to Georgian rather than rendering the
 * raw key: a missing translation should degrade to a readable page, not to
 * `error.stock.unavailable` shown to a customer.
 */

export type Locale = 'ka' | 'en';

export const DEFAULT_LOCALE: Locale = 'ka';

type Dictionary = Record<string, string>;

const ka: Dictionary = {
  /* errors */
  'error.validation': 'შეყვანილი მონაცემები არასწორია.',
  'error.unauthenticated': 'გთხოვთ გაიაროთ ავტორიზაცია.',
  'error.notFound': 'ვერ მოიძებნა.',
  'error.internal': 'დაფიქსირდა შეცდომა. სცადეთ თავიდან.',
  'error.vehicleRequired': 'ჯერ აირჩიეთ ავტომობილი.',
  'error.vin.length': 'VIN უნდა იყოს ზუსტად 17 სიმბოლო.',
  'error.vin.characters': 'VIN-ში არ გვხვდება ასოები I, O და Q.',
  'error.vin.invalid': 'VIN არასწორია.',
  'error.vin.notDecoded': 'ვერ მოვახერხეთ თქვენი ავტომობილის ამოცნობა.',
  'error.fitment.notConfirmed': 'ვერ დავადასტურეთ, რომ ეს ნაწილი თქვენს ავტომობილს მოერგება.',
  'error.fitment.uncertain': 'თავსებადობა დაუდასტურებელია.',
  'error.stock.unavailable': 'მოთხოვნილი რაოდენობა აღარ არის ხელმისაწვდომი.',
  'error.stock.soldOutAtCapture': 'სამწუხაროდ, ნაწილი გაიყიდა. თანხა არ ჩამოგეჭრათ.',
  'error.reservation.expired': 'რეზერვაციის დრო ამოიწურა. სცადეთ თავიდან.',
  'error.order.notCancellable': 'ამ შეკვეთის გაუქმება უკვე შეუძლებელია.',
  'error.order.notReady': 'შეკვეთა ჯერ არ არის მზად ასაღებად.',
  'error.order.notReceivable': 'შეკვეთის მიღების დადასტურება ამ ეტაპზე შეუძლებელია.',
  'error.payment.declined': 'გადახდა უარყოფილია.',
  'error.payment.captureFailed': 'გადახდის დასრულება ვერ მოხერხდა.',
  'error.pickup.codeMismatch': 'კოდი არ ემთხვევა.',
  'error.cart.multiplePartners': 'ერთ შეკვეთაში მხოლოდ ერთი გამყიდველია შესაძლებელი.',
  'error.auth.phoneInvalid': 'შეიყვანე მობილურის ნომერი — მაგალითად 555 12 34 56.',
  'error.auth.suspended': 'ანგარიში დაბლოკილია.',
  'error.otp.invalidCode': 'კოდი არასწორია ან ვადა გაუვიდა.',
  'error.otp.resendTooSoon': 'ახალი კოდი ცოტა ხანში შეიძლება მოითხოვო.',
  'error.otp.tooManyRequests': 'ამ ნომერზე ძალიან ბევრი კოდი გაიგზავნა. სცადე ერთი საათის შემდეგ.',
  'error.otp.tooManyAttempts': 'ძალიან ბევრი მცდელობა. მოითხოვე ახალი კოდი.',
  'error.otp.deliveryFailed': 'SMS ვერ გაიგზავნა. სცადე ხელახლა.',
  'error.idempotency.reused': 'მოთხოვნა უკვე დამუშავდა.',
  'error.provider.unavailable': 'სერვისი დროებით მიუწვდომელია.',
  'error.conflict.alreadyResolved': 'ეს კონფლიქტი უკვე გადაწყდა.',
  'error.refund.exceedsCharged': 'დასაბრუნებელი თანხა აღემატება გადახდილს.',
  'error.refund.noPayment': 'ამ შეკვეთას დადასტურებული გადახდა არ აქვს.',
  'error.network': 'ქსელთან კავშირი ვერ დამყარდა.',

  /* fitment (PRD §55) */
  'fitment.exact': 'თავსებადია თქვენს ავტომობილთან',
  'fitment.compatible': 'თავსებადია',
  'fitment.conditional': 'საჭიროა დამატებითი დადასტურება',
  'fitment.notCompatible': 'არ არის თავსებადი',
  'fitment.uncertain': 'თავსებადობა დაუდასტურებელია',

  /* order statuses (PRD §46) */
  'order.status.draft': 'მზადდება',
  'order.status.reserved': 'დარეზერვებულია',
  'order.status.awaitingPayment': 'ელოდება გადახდას',
  'order.status.paid': 'გადახდა დადასტურებულია',
  'order.status.received': 'შეკვეთა მიღებულია',
  'order.status.preparing': 'შეკვეთა მზადდება',
  'order.status.ready': 'მზადაა ასაღებად',
  'order.status.awaiting_pickup': 'ასაღებად გელოდებათ',
  'order.status.pickedUp': 'გაიცა',
  'order.status.completed': 'შეკვეთა მიღებულია',
  'order.status.cancelled': 'შეკვეთა გაუქმებულია',
  'order.status.failed': 'შეკვეთა ვერ შესრულდა',
  'order.status.refunded': 'თანხა დაბრუნებულია',

  /* availability (PRD §27) */
  'availability.inStock': 'მარაგშია',
  'availability.availableToOrder': 'შეკვეთით',
  'availability.unavailable': 'არ არის',

  /* clarifications (PRD §10) */
  'vin.clarify.brakeConfig':
    'თქვენს ავტომობილს აქვს 2 განსხვავებული სამუხრუჭე კონფიგურაცია. აირჩიეთ შესაბამისი:',
  'brake.standard': 'სტანდარტული',
  'brake.mSport': 'M Sport',

  /* sign-in (ADR-015) */
  'auth.title': 'შესვლა',
  'auth.phoneLabel': 'მობილურის ნომერი',
  'auth.phoneHint': 'გამოგიგზავნით ერთჯერად კოდს SMS-ით.',
  'auth.sendCode': 'კოდის მიღება',
  'auth.codeTitle': 'შეიყვანე კოდი',
  'auth.codeSentTo': 'ექვსნიშნა კოდი გამოგზავნილია ნომერზე',
  'auth.codeLabel': 'ერთჯერადი კოდი',
  'auth.verify': 'დადასტურება',
  'auth.resend': 'კოდის ხელახლა გაგზავნა',
  'auth.resendIn': 'ხელახლა გაგზავნა შესაძლებელია',
  'auth.changeNumber': 'ნომრის შეცვლა',
  'auth.nameLabel': 'სახელი',
  'auth.nameHint': 'პირველად ხარ აქ — როგორ მოგმართოთ?',
  'auth.signOut': 'გასვლა',
};

const en: Dictionary = {
  'error.validation': 'Some of the details are not valid.',
  'error.unauthenticated': 'Please sign in.',
  'error.notFound': 'Not found.',
  'error.internal': 'Something went wrong. Please try again.',
  'error.vehicleRequired': 'Choose a vehicle first.',
  'error.vin.length': 'A VIN is exactly 17 characters.',
  'error.vin.characters': 'A VIN never contains the letters I, O or Q.',
  'error.vin.invalid': 'That VIN is not valid.',
  'error.vin.notDecoded': "We couldn't identify your vehicle.",
  'error.fitment.notConfirmed': "We can't confirm this part fits your vehicle.",
  'error.fitment.uncertain': 'Compatibility is unconfirmed.',
  'error.stock.unavailable': 'That quantity is no longer available.',
  'error.stock.soldOutAtCapture': 'It sold out before payment completed. You were not charged.',
  'error.reservation.expired': 'The hold expired. Please start again.',
  'error.order.notCancellable': 'This order can no longer be cancelled.',
  'error.order.notReady': 'This order is not ready for pickup yet.',
  'error.order.notReceivable': "This order can't be confirmed as received yet.",
  'error.payment.declined': 'The payment was declined.',
  'error.payment.captureFailed': 'The payment could not be completed.',
  'error.pickup.codeMismatch': 'That code does not match.',
  'error.cart.multiplePartners': 'One checkout covers one seller.',
  'error.auth.phoneInvalid': 'Enter a mobile number — for example 555 12 34 56.',
  'error.auth.suspended': 'This account is suspended.',
  'error.otp.invalidCode': 'That code is wrong or has expired.',
  'error.otp.resendTooSoon': 'A new code can be requested in a moment.',
  'error.otp.tooManyRequests': 'Too many codes sent to this number. Try again in an hour.',
  'error.otp.tooManyAttempts': 'Too many attempts. Request a new code.',
  'error.otp.deliveryFailed': 'The SMS could not be sent. Please try again.',
  'error.idempotency.reused': 'This request was already processed.',
  'error.provider.unavailable': 'The service is temporarily unavailable.',
  'error.conflict.alreadyResolved': 'This conflict is already resolved.',
  'error.refund.exceedsCharged': 'That would refund more than was charged.',
  'error.refund.noPayment': 'This order has no captured payment.',
  'error.network': 'Could not reach the server.',

  'fitment.exact': 'Fits your vehicle',
  'fitment.compatible': 'Compatible',
  'fitment.conditional': 'Needs one more detail confirmed',
  'fitment.notCompatible': 'Does not fit',
  'fitment.uncertain': 'Compatibility unconfirmed',

  'order.status.draft': 'Draft',
  'order.status.reserved': 'Reserved',
  'order.status.awaitingPayment': 'Awaiting payment',
  'order.status.paid': 'Payment confirmed',
  'order.status.received': 'Order received',
  'order.status.preparing': 'Being prepared',
  'order.status.ready': 'Ready for pickup',
  'order.status.awaiting_pickup': 'Waiting for you',
  'order.status.pickedUp': 'Collected',
  'order.status.completed': 'Completed',
  'order.status.cancelled': 'Cancelled',
  'order.status.failed': 'Failed',
  'order.status.refunded': 'Refunded',

  'availability.inStock': 'In stock',
  'availability.availableToOrder': 'Available to order',
  'availability.unavailable': 'Unavailable',

  'vin.clarify.brakeConfig':
    'Your vehicle came with two brake configurations. Which one is it?',
  'brake.standard': 'Standard',
  'brake.mSport': 'M Sport',

  /* sign-in (ADR-015) */
  'auth.title': 'Sign in',
  'auth.phoneLabel': 'Mobile number',
  'auth.phoneHint': 'We will text you a one-time code.',
  'auth.sendCode': 'Send code',
  'auth.codeTitle': 'Enter the code',
  'auth.codeSentTo': 'A six-digit code was sent to',
  'auth.codeLabel': 'One-time code',
  'auth.verify': 'Confirm',
  'auth.resend': 'Send a new code',
  'auth.resendIn': 'A new code can be sent in',
  'auth.changeNumber': 'Use a different number',
  'auth.nameLabel': 'Name',
  'auth.nameHint': 'First time here — what should we call you?',
  'auth.signOut': 'Sign out',
};

const DICTIONARIES: Record<Locale, Dictionary> = { ka, en };

/**
 * Resolves a key.
 *
 * Falls back to Georgian, then to the key itself. Returning the key is a last
 * resort that should be visible in development, never a blank string that
 * hides the gap.
 */
export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
}

export function translator(locale: Locale) {
  return (key: string) => t(key, locale);
}

/** Keys present in Georgian but missing elsewhere. Used by a CI check. */
export function missingKeys(locale: Locale): string[] {
  const reference = Object.keys(DICTIONARIES[DEFAULT_LOCALE]);
  const target = DICTIONARIES[locale] ?? {};
  return reference.filter((key) => !(key in target));
}

export { ka, en };
