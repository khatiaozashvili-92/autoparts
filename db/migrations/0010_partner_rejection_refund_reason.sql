-- A partner declining an order is a refund reason the schema never had.
--
-- The original vocabulary was written when only three things could send money
-- back: the customer cancelled, the customer never collected, or stock ran out
-- between payment and capture. A partner saying "I cannot fulfil this" was not
-- possible, because there was no way for them to say it.
--
-- It could have been squeezed into STOCK_FAILURE, and for OUT_OF_STOCK that is
-- nearly true -- but a partner who declines because the catalogue maps the
-- wrong part, or for a reason of their own, is not reporting a stock failure.
-- Recording all of them as one would make the refund table lie about why the
-- platform gave money back, which is the one question that table exists to
-- answer.
--
-- The specific reason the partner gave stays on orders.cancellation_reason;
-- this is the category.

ALTER TABLE refunds DROP CONSTRAINT refund_reason_valid;

ALTER TABLE refunds
  ADD CONSTRAINT refund_reason_valid
  CHECK (reason IN (
    'CUSTOMER_CANCEL',
    'NO_SHOW',
    'STOCK_FAILURE',
    'ADMIN',
    'PARTNER_REJECTED'
  ));
