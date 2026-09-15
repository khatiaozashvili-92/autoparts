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
  'error.auth.invalidCredentials': 'არასწორი მონაცემები.',
  'error.auth.identifierRequired': 'საჭიროა email ან ტელეფონის ნომერი.',
  'error.auth.registrationFailed': 'რეგისტრაცია ვერ დასრულდა.',
  'error.auth.suspended': 'ანგარიში დაბლოკილია.',
  'error.password.tooShort': 'პაროლი უნდა იყოს მინიმუმ 10 სიმბოლო.',
  'error.password.tooCommon': 'ეს პაროლი ძალიან გავრცელებულია.',
  'error.password.tooSimple': 'პაროლი ძალიან მარტივია.',
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
  'error.auth.invalidCredentials': 'Those details are not right.',
  'error.auth.identifierRequired': 'An email or phone number is required.',
  'error.auth.registrationFailed': 'Registration could not be completed.',
  'error.auth.suspended': 'This account is suspended.',
  'error.password.tooShort': 'Use at least 10 characters.',
  'error.password.tooCommon': 'That password is too common.',
  'error.password.tooSimple': 'That password is too simple.',
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
