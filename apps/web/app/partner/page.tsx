'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote, Spinner } from '../../components/shell';

interface Dashboard {
  newOrders: number;
  preparing: number;
  readyForPickup: number;
  revenueTodayMinor: string;
  outOfStock: number;
  totalOffers: number;
  minutesSinceSync: number | null;
}

interface OnboardingStep {
  key: string;
  done: boolean;
  detail: string | null;
}

interface PartnerOrder {
  id: string;
  order_number: string;
  status: string;
  total_minor: string;
  currency: string;
  vehicle: string | null;
  engine: string | null;
  first_name: string | null;
  phone: string | null;
  pickup_deadline: string | null;
  items: { quantity: number; product: { name: string; brand: string }; basePriceMinor: string }[];
}

const STEP_LABELS: Record<string, string> = {
  approved: 'პლატფორმის დამტკიცება',
  location: 'აღების ფილიალი',
  inventory: 'პროდუქტების ატვირთვა',
  conflicts: 'თავსებადობის კონფლიქტები',
};

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'ახალი',
  PAID: 'ახალი',
  PREPARING: 'მზადდება',
  READY_FOR_PICKUP: 'ასაღებად',
  PICKED_UP: 'გაცემული',
  COMPLETED: 'დასრულებული',
  CANCELLED: 'გაუქმებული',
};

/**
 * Partner dashboard (docs/10).
 *
 * Built around the one thing a partner does every day — see new orders and
 * press "ready". Everything else is rarer, so it sits below.
 */
export default function PartnerDashboard() {
  const { api, me, loading: sessionLoading } = useSession();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [onboarding, setOnboarding] = useState<{ live: boolean; steps: OnboardingStep[] } | null>(null);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, o, list] = await Promise.all([
        api.request<Dashboard>('/partner/dashboard'),
        api.request<{ live: boolean; steps: OnboardingStep[] }>('/partner/onboarding'),
        api.request<PartnerOrder[]>('/partner/orders'),
      ]);
      setDashboard(d);
      setOnboarding(o);
      setOrders(list);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!sessionLoading && me?.partnerId) void load();
    else if (!sessionLoading) setLoading(false);
  }, [load, me, sessionLoading]);

  if (sessionLoading || loading) return <Spinner />;

  if (!me?.partnerId) {
    return (
      <section className="hero-block">
        <h1>პარტნიორის პანელი</h1>
        <p className="lede">ეს გვერდი მხოლოდ პარტნიორი კომპანიებისთვისაა.</p>
        <p className="muted small">
          სატესტოდ შედით ნომრით <code>555 00 00 02</code> — პაროლი აღარ არსებობს,
          კოდი ეკრანზე გამოჩნდება.
        </p>
      </section>
    );
  }

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
    <>
      <h1 className="page-title">პარტნიორის პანელი</h1>
      <ErrorNote error={error} />

      {onboarding && !onboarding.live && (
        <div className="card offline">
          <strong>შეთავაზებები ჯერ არ არის ცოცხალი</strong>
          <dl>
            {onboarding.steps.map((step) => (
              <div className="kv" key={step.key}>
                <dt>
                  <span className={`dot ${step.done ? 'ok' : 'idle'}`} />
                  {STEP_LABELS[step.key] ?? step.key}
                </dt>
                <dd className="muted small">{step.done ? 'დასრულებული' : (step.detail ?? '—')}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {dashboard && (
        <div className="grid">
          <div className="card stat">
            <div className="stat-value">{dashboard.newOrders}</div>
            <div className="muted small">ახალი შეკვეთა</div>
          </div>
          <div className="card stat">
            <div className="stat-value">{dashboard.readyForPickup}</div>
            <div className="muted small">ასაღებად</div>
          </div>
          <div className="card stat">
            <div className="stat-value">
              {formatMoney(dashboard.revenueTodayMinor, 'GEL')}
            </div>
            <div className="muted small">დღის შემოსავალი</div>
          </div>
          <div className="card stat">
            <div className="stat-value">{dashboard.totalOffers}</div>
            <div className="muted small">
              აქტიური პროდუქტი · {dashboard.outOfStock} ამოწურული
            </div>
          </div>
        </div>
      )}

      {dashboard?.minutesSinceSync !== null && dashboard && (
        <p className={`note ${dashboard.minutesSinceSync > 60 ? 'warn' : ''}`}>
          🕐 მარაგი ბოლოს განახლდა {dashboard.minutesSinceSync} წუთის წინ.
          {dashboard.minutesSinceSync > 60
            ? ' მოძველებული მარაგი გაუქმებულ შეკვეთებს ნიშნავს — განაახლეთ.'
            : ''}
        </p>
      )}

      <h2>შეკვეთები</h2>
      {orders.length === 0 ? (
        <p className="muted">ჯერ შეკვეთები არ არის.</p>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <div className="card" key={order.id}>
              <div className="offer-head">
                <div>
                  <strong>{order.order_number}</strong>
                  <span className="muted small"> · {STATUS_LABELS[order.status] ?? order.status}</span>
                </div>
                <div className="offer-price">
                  {formatMoney(order.total_minor, order.currency)}
                </div>
              </div>

              {/* The car, so the right part is pulled. The VIN is deliberately
                  not here — a partner does not need it (docs/07 §7). */}
              <p className="muted small" style={{ margin: '6px 0' }}>
                🚗 {order.vehicle ?? '—'}
                {order.engine ? ` · ${order.engine}` : ''}
              </p>

              <ul className="muted small" style={{ margin: '6px 0', paddingLeft: 18 }}>
                {(order.items ?? []).map((item, i) => (
                  <li key={i}>
                    {item.quantity} × {item.product?.name} ({item.product?.brand})
                  </li>
                ))}
              </ul>

              <p className="muted small">
                {order.first_name ?? '—'} · {order.phone ?? 'ტელეფონი არ არის'}
              </p>

              {['CONFIRMED', 'PAID', 'PREPARING'].includes(order.status) && (
                <>
                  <button
                    className="button primary full"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api.request(`/partner/orders/${order.id}/ready`, { method: 'POST' }),
                      )
                    }
                  >
                    მზადაა ასაღებად
                  </button>

                  {/*
                    The other honest answer. A stock figure is a claim about a
                    warehouse nobody re-counted this morning, so "it is not
                    actually here" has to be sayable — otherwise the only ways
                    out are letting the deadline lapse or phoning the customer,
                    and both leave someone waiting for a part that was never
                    coming.
                  */}
                  <button
                    className="button full reject-button"
                    disabled={busy}
                    onClick={() => setRejecting(rejecting === order.id ? null : order.id)}
                  >
                    ვერ შევასრულებ
                  </button>
                </>
              )}

              {rejecting === order.id && (
                <div className="clarify">
                  <p className="muted small" style={{ marginTop: 0 }}>
                    მომხმარებელს თანხა მაშინვე დაუბრუნდება. მიზეზი გვჭირდება, რომ მარაგი
                    გავასწოროთ — არა იმისთვის, რომ დაგადანაშაულოთ.
                  </p>
                  {(
                    [
                      ['OUT_OF_STOCK', 'მარაგში არ აღმოჩნდა', 'მარაგი შესწორდება'],
                      ['DAMAGED', 'დაზიანებულია', 'მარაგი შესწორდება'],
                      ['WRONG_PART', 'კატალოგში არასწორადაა', 'ადმინი გადახედავს'],
                      ['OTHER', 'სხვა მიზეზი', ''],
                    ] as const
                  ).map(([reason, label, effect]) => (
                    <button
                      key={reason}
                      className="button full"
                      disabled={busy}
                      style={{ marginTop: 6, textAlign: 'left' }}
                      onClick={() =>
                        act(async () => {
                          await api.request(`/partner/orders/${order.id}/reject`, {
                            method: 'POST',
                            body: { reason },
                          });
                          setRejecting(null);
                        })
                      }
                    >
                      {label}
                      {effect && <span className="muted small"> · {effect}</span>}
                    </button>
                  ))}
                  <button
                    className="link-button"
                    style={{ marginTop: 8 }}
                    onClick={() => setRejecting(null)}
                  >
                    გაუქმება
                  </button>
                </div>
              )}

              {order.status === 'READY_FOR_PICKUP' && (
                <>
                  {order.pickup_deadline && (
                    <p className="note">
                      ⏱ მომხმარებელს აქვს{' '}
                      {Math.max(
                        0,
                        Math.round(
                          (new Date(order.pickup_deadline).getTime() - Date.now()) / 3600000,
                        ),
                      )}{' '}
                      საათი. ვადის გასვლისას შეკვეთა ავტომატურად გაუქმდება და თანხა
                      დაბრუნდება.
                    </p>
                  )}
                  {verifying === order.id ? (
                    <div className="search-form">
                      <input
                        className="search-input mono"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-ნიშნა კოდი"
                        aria-label="აღების კოდი"
                      />
                      <button
                        className="button primary"
                        disabled={busy || code.length !== 6}
                        onClick={() =>
                          act(async () => {
                            await api.request(`/partner/orders/${order.id}/verify-pickup`, {
                              method: 'POST',
                              body: { code },
                            });
                            setVerifying(null);
                            setCode('');
                          })
                        }
                      >
                        გაცემა
                      </button>
                    </div>
                  ) : (
                    <button
                      className="button full"
                      onClick={() => {
                        setVerifying(order.id);
                        setCode('');
                      }}
                    >
                      კოდის შემოწმება
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
