/**
 * Domain enums — the single source of truth shared by API, web and mobile.
 * Mirrors the PostgreSQL enums in docs/03-database-schema.md §2.
 * Changing a value here is a breaking change: update the DB enum in the same PR.
 */

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  PARTNER_USER: 'PARTNER_USER',
  PARTNER_ADMIN: 'PARTNER_ADMIN',
  PLATFORM_SUPPORT: 'PLATFORM_SUPPORT',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const PartnerStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
} as const;
export type PartnerStatus = (typeof PartnerStatus)[keyof typeof PartnerStatus];

export const BrandType = {
  ORIGINAL_OEM: 'ORIGINAL_OEM',
  AFTERMARKET: 'AFTERMARKET',
  UNKNOWN: 'UNKNOWN',
} as const;
export type BrandType = (typeof BrandType)[keyof typeof BrandType];

export const ProductCondition = {
  NEW: 'NEW',
  USED: 'USED',
  REFURBISHED: 'REFURBISHED',
} as const;
export type ProductCondition = (typeof ProductCondition)[keyof typeof ProductCondition];

export const AvailabilityStatus = {
  IN_STOCK: 'IN_STOCK',
  AVAILABLE_TO_ORDER: 'AVAILABLE_TO_ORDER',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

/**
 * Fitment sources, in priority order (PRD §16).
 * ADMIN_MANUAL outranks everything — it is human-verified knowledge,
 * usually created precisely because a provider was wrong (docs/05 §3.1).
 */
export const FitmentSource = {
  ADMIN_MANUAL: 'ADMIN_MANUAL',
  PROVIDER_VIN: 'PROVIDER_VIN',
  PROVIDER_CONFIG: 'PROVIDER_CONFIG',
  OEM_MATCH: 'OEM_MATCH',
  TECHNICAL_DATA: 'TECHNICAL_DATA',
  PARTNER_DECLARED: 'PARTNER_DECLARED',
} as const;
export type FitmentSource = (typeof FitmentSource)[keyof typeof FitmentSource];

/** Lower number wins. Used by the engine to resolve competing claims. */
export const FITMENT_SOURCE_PRIORITY: Record<FitmentSource, number> = {
  ADMIN_MANUAL: 0,
  PROVIDER_VIN: 1,
  PROVIDER_CONFIG: 2,
  OEM_MATCH: 3,
  TECHNICAL_DATA: 4,
  PARTNER_DECLARED: 5,
};

export const FitmentVerdict = {
  EXACT: 'EXACT',
  COMPATIBLE: 'COMPATIBLE',
  CONDITIONAL: 'CONDITIONAL',
  UNCERTAIN: 'UNCERTAIN',
  NOT_COMPATIBLE: 'NOT_COMPATIBLE',
} as const;
export type FitmentVerdict = (typeof FitmentVerdict)[keyof typeof FitmentVerdict];

/**
 * R1 (PRD §97): a product is only ever shown as compatible when compatibility
 * is confirmed. UNCERTAIN is filtered out, never surfaced as "maybe".
 */
export const SELLABLE_VERDICTS: readonly FitmentVerdict[] = [
  FitmentVerdict.EXACT,
  FitmentVerdict.COMPATIBLE,
  FitmentVerdict.CONDITIONAL,
];

export function isSellable(v: FitmentVerdict): boolean {
  return SELLABLE_VERDICTS.includes(v);
}

export const ConflictStatus = {
  OPEN: 'OPEN',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  MAPPED: 'MAPPED',
} as const;
export type ConflictStatus = (typeof ConflictStatus)[keyof typeof ConflictStatus];

export const IntegrationMode = {
  API: 'API',
  CSV: 'CSV',
  MANUAL: 'MANUAL',
} as const;
export type IntegrationMode = (typeof IntegrationMode)[keyof typeof IntegrationMode];

export const SyncStatus = {
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  RUNNING: 'RUNNING',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const ReservationStatus = {
  ACTIVE: 'ACTIVE',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  RELEASED: 'RELEASED',
} as const;
export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const OrderStatus = {
  DRAFT: 'DRAFT',
  STOCK_RESERVED: 'STOCK_RESERVED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  PICKED_UP: 'PICKED_UP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** PRD §51: customer cancellation is closed once the part is ready. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.STOCK_RESERVED,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
];

export function canCustomerCancel(status: OrderStatus): boolean {
  return CUSTOMER_CANCELLABLE_STATUSES.includes(status);
}

/** Backend enum → i18n key. Backend statuses never reach the UI (PRD §46). */
export const ORDER_STATUS_I18N: Record<OrderStatus, string> = {
  DRAFT: 'order.status.draft',
  STOCK_RESERVED: 'order.status.reserved',
  AWAITING_PAYMENT: 'order.status.awaitingPayment',
  PAID: 'order.status.paid',
  CONFIRMED: 'order.status.received',
  PREPARING: 'order.status.preparing',
  READY_FOR_PICKUP: 'order.status.ready',
  PICKED_UP: 'order.status.pickedUp',
  COMPLETED: 'order.status.completed',
  CANCELLED: 'order.status.cancelled',
  FAILED: 'order.status.failed',
  REFUNDED: 'order.status.refunded',
};

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const SettlementStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export const DeliveryMethod = {
  PICKUP: 'PICKUP',
  /** P1 — schema-ready, feature-flagged off (PRD §1, §85). */
  COURIER: 'COURIER',
} as const;
export type DeliveryMethod = (typeof DeliveryMethod)[keyof typeof DeliveryMethod];

export const PaymentTerms = {
  FULL_PREPAYMENT: 'FULL_PREPAYMENT',
  PARTIAL_ADVANCE: 'PARTIAL_ADVANCE',
  PAY_ON_ARRIVAL: 'PAY_ON_ARRIVAL',
  OTHER: 'OTHER',
} as const;
export type PaymentTerms = (typeof PaymentTerms)[keyof typeof PaymentTerms];

export const RequestStatus = {
  OPEN: 'OPEN',
  ANSWERED: 'ANSWERED',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  PUSH: 'PUSH',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const IdentifierKind = {
  OEM: 'OEM',
  MPN: 'MPN',
  SKU: 'SKU',
  EAN: 'EAN',
} as const;
export type IdentifierKind = (typeof IdentifierKind)[keyof typeof IdentifierKind];
