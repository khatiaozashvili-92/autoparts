'use client';

import { TransactionHistory } from '../../../components/transactions';

/**
 * Every payment and refund on the marketplace.
 *
 * The only view that carries the platform's commission, because it is the
 * only one that should: a partner seeing what the platform kept on their sale
 * is a commercial conversation, not a reporting feature.
 */
export default function AdminTransactionsPage() {
  return <TransactionHistory endpoint="/admin/transactions" showPartner showCustomer />;
}
