'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatMoney, type Cart } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote, Spinner } from '../../components/shell';

export default function CartPage() {
  const { api, me, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCart(await api.cart());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!sessionLoading && me) void load();
    else if (!sessionLoading) setLoading(false);
  }, [load, me, sessionLoading]);

  if (sessionLoading || loading) return <Spinner />;

  if (!me) {
    return (
      <section className="hero-block">
        <h1>კალათის სანახავად შედით</h1>
        <Link className="button primary" href="/login?next=/cart">
          შესვლა
        </Link>
      </section>
    );
  }

  async function change(itemId: string, quantity: number) {
    setError(null);
    try {
      setCart(await api.updateCartItem(itemId, quantity));
    } catch (err) {
      setError(err);
      await load();
    }
  }

  async function remove(itemId: string) {
    setCart(await api.removeCartItem(itemId).catch(() => cart));
  }

  return (
    <>
      <h1 className="page-title">კალათა</h1>
      <ErrorNote error={error} />

      {!cart || cart.items.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>კალათა ცარიელია.</p>
          <p className="muted small">
            <Link href="/">ნაწილის ძებნა →</Link>
          </p>
        </div>
      ) : (
        <>
          {cart.blocker === 'MULTIPLE_PARTNERS' && (
            <div className="card offline">
              <strong>ერთ შეკვეთაში მხოლოდ ერთი გამყიდველია შესაძლებელი.</strong>
              <p className="muted small">
                გამოყავით შეკვეთები — თითო პარტნიორზე ცალკე. ეს დროებითი შეზღუდვაა და
                მონაცემთა სტრუქტურა უკვე multi-vendor-ია.
              </p>
            </div>
          )}

          <div className="card">
            {cart.items.map((item) => (
              <div className="cart-row" key={item.id}>
                <div>
                  <div className="result-name">{item.productName}</div>
                  <div className="muted small">
                    {item.brandName} · {item.partner.displayName}
                  </div>
                  <div className="muted small">{item.vehicleLabel}-სთვის</div>
                </div>
                <div className="cart-qty">
                  <button className="qty-button" onClick={() => change(item.id, item.quantity - 1)}>
                    −
                  </button>
                  <span>{item.quantity}</span>
                  <button className="qty-button" onClick={() => change(item.id, item.quantity + 1)}>
                    +
                  </button>
                </div>
                <div className="cart-total">
                  {formatMoney(item.lineTotalMinor, item.currency)}
                  <button className="link-button" onClick={() => remove(item.id)}>
                    წაშლა
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="card summary">
            <div className="kv">
              <dt>ჯამი</dt>
              <dd className="big">
                {cart.currency ? formatMoney(cart.subtotalMinor, cart.currency) : '—'}
              </dd>
            </div>
            <p className="muted small" style={{ margin: '4px 0 12px' }}>
              საბოლოო თანხა და აღების მისამართი შემდეგ ეკრანზე დაგიდასტურდებათ.
            </p>
            <button
              className="button primary full"
              disabled={cart.blocker === 'MULTIPLE_PARTNERS'}
              onClick={() => router.push('/checkout')}
            >
              გაგრძელება
            </button>
          </div>
        </>
      )}
    </>
  );
}
