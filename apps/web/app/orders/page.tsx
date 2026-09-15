'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatMoney, type OrderSummary } from '@autoparts/api-client';
import { ORDER_STATUS_I18N, type OrderStatus } from '@autoparts/core';
import { useSession } from '../../lib/session';
import { Spinner } from '../../components/shell';

export default function OrdersPage() {
  const { api, t, me, loading: sessionLoading } = useSession();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!me) {
      setLoading(false);
      return;
    }
    void api
      .orders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [api, me, sessionLoading]);

  if (sessionLoading || loading) return <Spinner />;

  if (!me) {
    return (
      <section className="hero-block">
        <h1>შეკვეთების სანახავად შედით</h1>
        <Link className="button primary" href="/login?next=/orders">
          შესვლა
        </Link>
      </section>
    );
  }

  return (
    <>
      <h1 className="page-title">ჩემი შეკვეთები</h1>

      {orders.length === 0 ? (
        <p className="muted">ჯერ არცერთი შეკვეთა არ გაქვთ.</p>
      ) : (
        <div className="card">
          <dl>
            {orders.map((order) => (
              <div className="kv" key={order.id}>
                <dt>
                  <Link href={`/orders/${order.id}`}>{order.order_number}</Link>
                  <br />
                  <span className="muted small">
                    {order.partner_name} · {order.item_count} ერთეული ·{' '}
                    {new Date(order.created_at).toLocaleDateString('ka-GE')}
                  </span>
                </dt>
                <dd>
                  {formatMoney(order.total_minor, order.currency)}
                  <br />
                  {/* Backend enums never reach the screen (PRD §46). */}
                  <span className="muted small">
                    {t(ORDER_STATUS_I18N[order.status as OrderStatus] ?? 'order.status.draft')}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}
