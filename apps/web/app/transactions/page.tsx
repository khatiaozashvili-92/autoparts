'use client';

import { TransactionHistory } from '../../components/transactions';

/**
 * The customer's own money: what they paid, and what came back.
 *
 * The seller is shown because a customer buys from several of them and needs
 * to know which shop a charge belongs to. The platform's commission is not in
 * the response at all — to a customer there is one price, which is the whole
 * point of how the marketplace quotes (docs/08 §3).
 */
export default function CustomerTransactionsPage() {
  return <TransactionHistory endpoint="/transactions" showPartner />;
}
