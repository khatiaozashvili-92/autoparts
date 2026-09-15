import { randomUUID } from 'node:crypto';

/**
 * Payment provider seam (PRD §44, docs/08 §5).
 *
 * No Georgian acquirer is named in the code. Which bank processes a payment is
 * a deployment decision, and the contract is still open — so development and
 * CI run on the mock, and switching to a real acquirer is one adapter
 * (docs/00, open question #1).
 */

export interface Money {
  amountMinor: bigint;
  currency: string;
}

export interface PaymentIntentRequest {
  orderId: string;
  orderNumber: string;
  amount: Money;
  /** The platform's cut, for acquirers that split the settlement themselves. */
  commission: Money;
  partnerId: string;
  customerId: string;
  idempotencyKey: string;
  returnUrl?: string;
}

export interface PaymentIntent {
  provider: string;
  transactionId: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
  /** Where to send the customer, when the provider hosts the payment page. */
  redirectUrl?: string;
  raw: Record<string, unknown>;
}

export interface CaptureResult {
  transactionId: string;
  status: 'CAPTURED' | 'FAILED';
  failureCode?: string;
  raw: Record<string, unknown>;
}

export interface RefundResult {
  refundId: string;
  status: 'REFUNDED' | 'PENDING' | 'FAILED';
  raw: Record<string, unknown>;
}

export interface PaymentCapabilities {
  /** Whether the acquirer pays the partner directly, or we settle ourselves. */
  splitSettlement: boolean;
  partialRefund: boolean;
  applePay: boolean;
  googlePay: boolean;
  currencies: string[];
}

export interface PaymentProvider {
  readonly name: string;
  capabilities(): PaymentCapabilities;
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntent>;
  capture(transactionId: string, amount: Money): Promise<CaptureResult>;
  void(transactionId: string): Promise<{ status: 'CANCELLED' | 'FAILED' }>;
  refund(transactionId: string, amount: Money, idempotencyKey: string): Promise<RefundResult>;
}

/**
 * In-memory provider for development, tests and CI.
 *
 * Deliberately able to fail: a payment integration that only ever succeeds
 * hides the paths that matter most — a declined card, and a capture that fails
 * after the stock has been reserved.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly transactions = new Map<
    string,
    { amount: Money; status: string; refunded: bigint }
  >();

  /** Cards whose number ends in these digits fail, for exercising the sad path. */
  constructor(private readonly failFor: Set<string> = new Set()) {}

  capabilities(): PaymentCapabilities {
    return {
      splitSettlement: false,
      partialRefund: true,
      applePay: false,
      googlePay: false,
      currencies: ['GEL', 'USD', 'EUR'],
    };
  }

  async createIntent(request: PaymentIntentRequest): Promise<PaymentIntent> {
    if (this.failFor.has(request.orderNumber)) {
      return {
        provider: this.name,
        transactionId: `mock_failed_${randomUUID()}`,
        status: 'FAILED',
        raw: { reason: 'declined_by_test_fixture' },
      };
    }

    const transactionId = `mock_${randomUUID()}`;
    this.transactions.set(transactionId, {
      amount: request.amount,
      status: 'AUTHORIZED',
      refunded: 0n,
    });

    return {
      provider: this.name,
      transactionId,
      status: 'AUTHORIZED',
      raw: { orderNumber: request.orderNumber },
    };
  }

  async capture(transactionId: string, amount: Money): Promise<CaptureResult> {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      return { transactionId, status: 'FAILED', failureCode: 'unknown_transaction', raw: {} };
    }
    if (tx.amount.amountMinor !== amount.amountMinor) {
      // Capturing a different amount than was authorised is a bug upstream, not
      // something to quietly allow.
      return { transactionId, status: 'FAILED', failureCode: 'amount_mismatch', raw: {} };
    }
    tx.status = 'CAPTURED';
    return { transactionId, status: 'CAPTURED', raw: {} };
  }

  async void(transactionId: string): Promise<{ status: 'CANCELLED' | 'FAILED' }> {
    const tx = this.transactions.get(transactionId);
    if (!tx || tx.status === 'CAPTURED') return { status: 'FAILED' };
    tx.status = 'CANCELLED';
    return { status: 'CANCELLED' };
  }

  async refund(
    transactionId: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const tx = this.transactions.get(transactionId);
    if (!tx) return { refundId: '', status: 'FAILED', raw: { reason: 'unknown_transaction' } };

    if (tx.refunded + amount.amountMinor > tx.amount.amountMinor) {
      // Over-refunding is real money lost; the provider refuses rather than
      // relying on the caller having checked.
      return { refundId: '', status: 'FAILED', raw: { reason: 'exceeds_captured_amount' } };
    }

    tx.refunded += amount.amountMinor;
    return {
      refundId: `mock_refund_${idempotencyKey.slice(0, 8)}`,
      status: 'REFUNDED',
      raw: { refundedTotal: tx.refunded.toString() },
    };
  }
}
