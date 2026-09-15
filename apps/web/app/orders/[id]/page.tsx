'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatMoney, type PickupCredential } from '@autoparts/api-client';
import { ORDER_STATUS_I18N, type OrderStatus } from '@autoparts/core';
import { useSession } from '../../../lib/session';
import { ErrorNote, Spinner } from '../../../components/shell';

/**
 * A QR made of divs.
 *
 * A real QR encoder is a Step 12 refinement; the six-digit code beneath it is
 * the fallback the counter can always use, and PRD §49 requires that fallback
 * anyway — a service centre with no camera or no signal must still be able to
 * hand the part over.
 */
function CodeBlock({ code }: { code: string }) {
  return (
    <div className="pickup-code">
      <div className="pickup-code-digits mono">{code.split('').join(' ')}</div>
      <p className="muted small" style={{ margin: 0 }}>
        აჩვენეთ ეს კოდი გამყიდველს
      </p>
    </div>
  );
}

function useCountdown(deadline: string | null | undefined) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, new Date(deadline).getTime() - Date.now()));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [deadline]);

  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return { remaining, label: `${hours} სთ ${minutes} წთ` };
}

export default function OrderDetailPage() {
  const { api, t } = useSession();
  const id = String(useParams().id);

  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [pickup, setPickup] = useState<PickupCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.order(id);
      setOrder(detail);
      if (['READY_FOR_PICKUP', 'PICKED_UP'].includes(String(detail['status']))) {
        setPickup(await api.pickupCode(id).catch(() => null));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const deadline = order?.['pickup_deadline'] as string | null | undefined;
  const { remaining, label } = useCountdown(deadline);

  if (loading) return <Spinner />;
  if (!order) return <ErrorNote error={error} />;

  const status = String(order['status']) as OrderStatus;
  const items = (order['items'] as Record<string, unknown>[]) ?? [];

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow">
      <h1 className="page-title">{String(order['order_number'])}</h1>
      <p className="status-line">{t(ORDER_STATUS_I18N[status] ?? 'order.status.draft')}</p>

      <ErrorNote error={error} />

      {status === 'READY_FOR_PICKUP' && pickup && (
        <div className="card pickup-card">
          <h2 style={{ marginTop: 0 }}>მზადაა ასაღებად</h2>
          <CodeBlock code={pickup.code} />
          <dl>
            <div className="kv">
              <dt>გამყიდველი</dt>
              <dd>{pickup.partnerName}</dd>
            </div>
            <div className="kv">
              <dt>მისამართი</dt>
              <dd>{pickup.location.address}</dd>
            </div>
          </dl>
          {deadline && (
            <p className={`note ${remaining < 4 * 3600000 ? 'warn' : ''}`}>
              ⏱ დარჩა {label}. ვადის გასვლისას შეკვეთა ავტომატურად გაუქმდება და თანხა
              სრულად დაგიბრუნდებათ.
            </p>
          )}
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => act(() => api.confirmReceipt(id))}
          >
            მივიღე შეკვეთა
          </button>
        </div>
      )}

      {status === 'PICKED_UP' && (
        <div className="card">
          <p style={{ margin: 0 }}>გამყიდველმა გასცა ნაწილი.</p>
          <p className="muted small">
            შეკვეთა დასრულებულად ჩაითვლება მას შემდეგ, რაც თქვენ დაადასტურებთ მიღებას.
          </p>
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => act(() => api.confirmReceipt(id))}
          >
            მივიღე შეკვეთა
          </button>
        </div>
      )}

      <div className="card">
        {items.map((item, index) => {
          const snapshot = (item['product_snapshot'] ?? {}) as Record<string, string>;
          return (
            <div className="kv" key={index}>
              <dt>
                {snapshot['name']}
                <br />
                <span className="muted small">
                  {snapshot['brand']} · {String(item['quantity'])} ცალი ·{' '}
                  {String(item['fitment_verdict'])}
                </span>
              </dt>
              <dd>{formatMoney(String(item['line_total_minor']), String(item['currency']))}</dd>
            </div>
          );
        })}
      </div>

      <div className="card summary">
        <div className="kv">
          <dt>პროდუქტი</dt>
          <dd>{formatMoney(String(order['subtotal_minor']), String(order['currency']))}</dd>
        </div>
        <div className="kv">
          <dt>მომსახურება</dt>
          <dd>{formatMoney(String(order['markup_minor']), String(order['currency']))}</dd>
        </div>
        <div className="kv">
          <dt>ჯამი</dt>
          <dd className="big">
            {formatMoney(String(order['total_minor']), String(order['currency']))}
          </dd>
        </div>
      </div>

      {order['canCancel'] === true && (
        <button
          className="button full"
          disabled={busy}
          onClick={() => act(() => api.cancelOrder(id))}
        >
          შეკვეთის გაუქმება
        </button>
      )}

      {status === 'CANCELLED' && (
        <p className="muted small">
          გაუქმების მიზეზი: {String(order['cancellation_reason'] ?? '—')}
          {order['payment_status'] === 'REFUNDED' ? ' · თანხა დაბრუნებულია' : ''}
        </p>
      )}
    </section>
  );
}
