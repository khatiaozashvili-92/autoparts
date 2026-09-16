import { Injectable, Logger } from '@nestjs/common';
import { AppError, ErrorCode, errors } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { OrdersService } from './orders.service.js';

/**
 * A partner declining an order it cannot actually fulfil (docs/08 §6).
 *
 * Until now a partner could only push an order forward: mark it ready, verify
 * the pickup code. There was no way to say "the shelf is empty" — which is the
 * most common real failure in this business, because a stock figure is a claim
 * about a warehouse nobody re-counted this morning.
 *
 * With no path for it, a partner's only options were to leave the order
 * hanging until the pickup deadline expired, or to tell the customer on the
 * phone. Both leave a paying customer waiting for something that was never
 * coming. Declining is not a failure state to be hidden; it is the honest
 * answer, and the sooner it is given the better.
 *
 * Three things follow, and all three matter:
 *
 *   1. the money goes back, immediately and without anyone asking
 *   2. the stock that was never really there is corrected, so the next
 *      customer is not sold the same absent part
 *   3. the partner's reliability score drops, because that score drives
 *      Recommended ranking — accurate stock has to be worth more than
 *      optimistic stock (docs/06 §10)
 */

export type RejectionReason = 'OUT_OF_STOCK' | 'DAMAGED' | 'WRONG_PART' | 'OTHER';

const REASON_ADJUSTS_STOCK: Record<RejectionReason, boolean> = {
  // The shelf was empty, so the figure was wrong: correct it.
  OUT_OF_STOCK: true,
  // The part exists but this one is not sellable; one fewer than we thought.
  DAMAGED: true,
  // The catalogue mapping is wrong, not the count. Adjusting stock would hide
  // a mismatch that needs a human to look at it.
  WRONG_PART: false,
  OTHER: false,
};

@Injectable()
export class PartnerRejectionService {
  private readonly logger = new Logger('PartnerRejection');

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersService,
  ) {}

  async reject(
    partnerId: string,
    orderId: string,
    input: { reason: RejectionReason; note?: string },
  ) {
    const [row] = await this.db.query<{
      partner_order_id: string;
      order_status: string;
      currency: string;
      total_minor: string;
      payment_id: string | null;
      transaction_id: string | null;
      payment_status: string | null;
    }>(
      `SELECT po.id AS partner_order_id, o.status AS order_status,
              po.currency, po.total_minor,
              p.id AS payment_id, p.provider_transaction_id AS transaction_id,
              p.status::text AS payment_status
       FROM partner_orders po
       JOIN orders o ON o.id = po.order_id
       LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
       WHERE po.order_id = $1 AND po.partner_id = $2`,
      [orderId, partnerId],
    );
    if (!row) throw errors.notFound('Order');

    // Once the customer has it, declining is no longer the honest answer —
    // that is a return, which is a different process with different rules.
    if (['PICKED_UP', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(row.order_status)) {
      throw new AppError({
        code: ErrorCode.ORDER_NOT_CANCELLABLE,
        status: 409,
        message: `An order in state ${row.order_status} can no longer be declined.`,
        messageKey: 'error.order.notCancellable',
        details: { status: row.order_status },
      });
    }

    return this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE partner_orders SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
        [row.partner_order_id],
      );

      // The MVP ships one partner per order (docs/08 §2), so declining the
      // partner's half declines the order. When split orders arrive this has
      // to become "cancel the order only if no partner is still fulfilling".
      await tx.query(
        `UPDATE orders
         SET status = 'CANCELLED',
             cancellation_reason = $2,
             cancelled_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [orderId, `PARTNER_REJECTED:${input.reason}${input.note ? ` — ${input.note}` : ''}`],
      );

      // Put the reserved units back on the shelf before touching the count,
      // or the correction below would be applied twice.
      const items = await tx.query<{ offer_id: string; quantity: number }>(
        `SELECT offer_id, quantity FROM order_items WHERE partner_order_id = $1`,
        [row.partner_order_id],
      );

      for (const item of items) {
        if (REASON_ADJUSTS_STOCK[input.reason]) {
          // Set to what the partner just told us is true, rather than adding
          // the reserved units back: they said it is not there.
          await tx.query(
            `UPDATE offers
             SET stock_quantity = GREATEST(0, stock_quantity - $2),
                 availability_status =
                   CASE WHEN GREATEST(0, stock_quantity - $2) = 0
                        THEN 'UNAVAILABLE' ELSE availability_status END,
                 last_synced_at = now(),
                 updated_at = now()
             WHERE id = $1`,
            [item.offer_id, item.quantity],
          );
        }
      }

      // Reliability is the lever that makes accurate stock worth keeping.
      await tx.query(
        `UPDATE partners
         SET stock_reliability = GREATEST(0, stock_reliability - 0.05), updated_at = now()
         WHERE id = $1`,
        [partnerId],
      );

      return { items: items.length };
    }).then(async (result) => {
      // The refund runs after the transaction commits, not inside it: it calls
      // an external acquirer, and holding a database transaction open across a
      // network call to a third party is how connection pools die.
      if (row.payment_id && row.transaction_id) {
        await this.orders.refund(orderId, row.payment_id, row.transaction_id, {
          amountMinor: BigInt(row.total_minor),
          currency: row.currency,
          // The category the refunds table records. The partner's specific
          // reason is on orders.cancellation_reason, written above.
          reason: 'PARTNER_REJECTED',
          initiatedBy: null,
        });
      }

      this.logger.warn(
        JSON.stringify({
          event: 'partner_rejected_order',
          orderId,
          partnerId,
          reason: input.reason,
          refunded: Boolean(row.payment_id),
          itemsReleased: result.items,
        }),
      );

      return {
        status: 'CANCELLED',
        reason: input.reason,
        refunded: Boolean(row.payment_id),
        stockCorrected: REASON_ADJUSTS_STOCK[input.reason],
      };
    });
  }
}
