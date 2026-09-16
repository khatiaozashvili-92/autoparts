'use client';

import { TransactionHistory } from '../../../components/transactions';

/**
 * A partner's own money, on their own orders.
 *
 * The seller column is omitted because it would say the same name on every
 * row. The commission is absent from the response, not hidden here.
 */
export default function PartnerTransactionsPage() {
  return <TransactionHistory endpoint="/partner/transactions" showCustomer />;
}
