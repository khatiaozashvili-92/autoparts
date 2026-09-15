'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney, type CheckoutQuote } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote, Spinner } from '../../components/shell';

/** Counts the hold down. The customer must see that the clock is running. */
function useCountdown(expiresAt: string | undefined) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return { remaining, label: `${minutes}:${String(seconds).padStart(2, '0')}` };
}

export default function CheckoutPage() {
  const { api } = useSession();
  const router = useRouter();

  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [stage, setStage] = useState<'reserving' | 'ready' | 'paying' | 'done'>('reserving');
  const [error, setError] = useState<unknown>(null);
  // Generated once per checkout attempt, so a retry cannot create two orders.
  const idempotencyKey = useRef(
    globalThis.crypto?.randomUUID?.() ?? `ck-${Date.now()}-${Math.random()}`,
  );

  const { remaining, label } = useCountdown(quote?.expiresAt);

  const reserve = useCallback(async () => {
    setStage('reserving');
    setError(null);
    try {
      setQuote(await api.reserve());
      setStage('ready');
    } catch (err) {
      setError(err);
      setStage('ready');
    }
  }, [api]);

  useEffect(() => {
    void reserve();
  }, [reserve]);

  async function pay() {
    if (!quote) return;
    setStage('paying');
    setError(null);
    try {
      const order = await api.confirm(quote.reservationIds, idempotencyKey.current);
      await api.capture(order.orderId);
      setStage('done');
      router.push(`/orders/${order.orderId}`);
    } catch (err) {
      setError(err);
      setStage('ready');
    }
  }

  if (stage === 'reserving' && !quote) return <Spinner label="მარაგს ვამოწმებთ…" />;

  return (
    <section className="narrow">
      <h1 className="page-title">გადახდა</h1>

      <ErrorNote error={error} />

      {quote && (
        <>
          <div className={`hold-banner ${remaining < 120000 ? 'warn' : ''}`}>
            ⏱ მარაგი დარეზერვებულია — {label}
          </div>

          <div className="card">
            <dl>
              <div className="kv">
                <dt>გამყიდველი</dt>
                <dd>{quote.partner.displayName}</dd>
              </div>
              <div className="kv">
                <dt>აღების ადგილი</dt>
                <dd>
                  {quote.pickupLocation.name}
                  <br />
                  <span className="muted small">{quote.pickupLocation.address}</span>
                </dd>
              </div>
              <div className="kv">
                <dt>მიღების წესი</dt>
                <dd>თვითგატანა</dd>
              </div>
            </dl>
          </div>

          <div className="card summary">
            <div className="kv">
              <dt>პროდუქტი</dt>
              <dd>{formatMoney(quote.totals.subtotalMinor, quote.totals.currency)}</dd>
            </div>
            <div className="kv">
              <dt>მომსახურება</dt>
              <dd>{formatMoney(quote.totals.markupMinor, quote.totals.currency)}</dd>
            </div>
            <div className="kv">
              <dt>ჯამი</dt>
              <dd className="big">{formatMoney(quote.totals.totalMinor, quote.totals.currency)}</dd>
            </div>
          </div>

          <div className="card">
            <p className="muted small" style={{ marginTop: 0 }}>
              <strong>გაუქმება:</strong> შეკვეთის გაუქმება შესაძლებელია მანამ, სანამ
              გამყიდველი არ მონიშნავს „მზადაა ასაღებად“. ამის შემდეგ თანხა სრულად
              ბრუნდება ავტომატურად.
            </p>
            <p className="muted small">
              <strong>აღების ვადა:</strong> „მზადაა ასაღებად“-იდან 24 საათი. ვადის გასვლისას
              შეკვეთა ავტომატურად უქმდება და თანხა ბრუნდება.
            </p>
          </div>

          {remaining === 0 ? (
            <button className="button primary full" onClick={reserve}>
              რეზერვაციის დრო ამოიწურა — თავიდან ცდა
            </button>
          ) : (
            <button className="button primary full" onClick={pay} disabled={stage === 'paying'}>
              {stage === 'paying' ? 'მუშავდება…' : 'გადახდა'}
            </button>
          )}

          <p className="muted small" style={{ textAlign: 'center' }}>
            გადახდის პროვაიდერი: <code>mock</code> — რეალური თანხა არ იხარჯება.
          </p>
        </>
      )}
    </section>
  );
}
