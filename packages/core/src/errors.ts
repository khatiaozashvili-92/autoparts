/**
 * Error model (docs/04 §1.2).
 *
 * Every error carries a machine-readable `code`, a developer-facing English
 * `message`, and a `messageKey` that the client renders through i18n. Clients
 * must never display `message` — it is not translated (PRD §80).
 */

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  VIN_INVALID: 'VIN_INVALID',
  VIN_NOT_DECODED: 'VIN_NOT_DECODED',
  VEHICLE_REQUIRED: 'VEHICLE_REQUIRED',

  FITMENT_NOT_CONFIRMED: 'FITMENT_NOT_CONFIRMED',
  FITMENT_UNCERTAIN: 'FITMENT_UNCERTAIN',

  STOCK_UNAVAILABLE: 'STOCK_UNAVAILABLE',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',

  PAYMENT_FAILED: 'PAYMENT_FAILED',
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',

  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode | string;
    /** English, for developers and logs. Never shown to end users. */
    message: string;
    /** i18n key — this is what the UI renders. */
    messageKey: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly messageKey: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(opts: {
    code: ErrorCode | string;
    status: number;
    message: string;
    messageKey: string;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.code = opts.code;
    this.status = opts.status;
    this.messageKey = opts.messageKey;
    this.details = opts.details;
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        messageKey: this.messageKey,
        ...(this.details ? { details: this.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
}

export const errors = {
  validation: (details?: Record<string, unknown>) =>
    new AppError({
      code: ErrorCode.VALIDATION_FAILED,
      status: 400,
      message: 'Request validation failed.',
      messageKey: 'error.validation',
      ...(details ? { details } : {}),
    }),

  unauthenticated: () =>
    new AppError({
      code: ErrorCode.UNAUTHENTICATED,
      status: 401,
      message: 'Authentication required.',
      messageKey: 'error.unauthenticated',
    }),

  /**
   * Returned instead of 403 where the mere existence of a resource is itself
   * information — a partner must not learn that another partner's offer exists
   * (docs/07 §5.1).
   */
  notFound: (what = 'Resource') =>
    new AppError({
      code: ErrorCode.NOT_FOUND,
      status: 404,
      message: `${what} not found.`,
      messageKey: 'error.notFound',
    }),

  vehicleRequired: () =>
    new AppError({
      code: ErrorCode.VEHICLE_REQUIRED,
      status: 400,
      message: 'A vehicle must be selected before searching for parts.',
      messageKey: 'error.vehicleRequired',
    }),

  vinInvalid: (reason: string) =>
    new AppError({
      code: ErrorCode.VIN_INVALID,
      status: 400,
      message: `VIN is not valid: ${reason}.`,
      messageKey: 'error.vin.invalid',
      details: { reason },
    }),

  fitmentNotConfirmed: (details: Record<string, unknown>) =>
    new AppError({
      code: ErrorCode.FITMENT_NOT_CONFIRMED,
      status: 422,
      message: 'Compatibility with this vehicle could not be confirmed.',
      messageKey: 'error.fitment.notConfirmed',
      details,
    }),

  stockUnavailable: (details: Record<string, unknown>) =>
    new AppError({
      code: ErrorCode.STOCK_UNAVAILABLE,
      status: 409,
      message: 'Requested quantity is no longer available.',
      messageKey: 'error.stock.unavailable',
      details,
    }),

  reservationExpired: () =>
    new AppError({
      code: ErrorCode.RESERVATION_EXPIRED,
      status: 410,
      message: 'The reservation has expired.',
      messageKey: 'error.reservation.expired',
    }),

  orderNotCancellable: () =>
    new AppError({
      code: ErrorCode.ORDER_NOT_CANCELLABLE,
      status: 409,
      message: 'This order can no longer be cancelled.',
      messageKey: 'error.order.notCancellable',
    }),

  idempotencyReused: () =>
    new AppError({
      code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
      status: 409,
      message: 'Idempotency key was reused with a different payload.',
      messageKey: 'error.idempotency.reused',
    }),

  providerUnavailable: (provider: string) =>
    new AppError({
      code: ErrorCode.PROVIDER_UNAVAILABLE,
      status: 503,
      message: `Provider "${provider}" is unavailable.`,
      messageKey: 'error.provider.unavailable',
      details: { provider },
    }),

  internal: () =>
    new AppError({
      code: ErrorCode.INTERNAL,
      status: 500,
      message: 'Internal server error.',
      messageKey: 'error.internal',
    }),
};
