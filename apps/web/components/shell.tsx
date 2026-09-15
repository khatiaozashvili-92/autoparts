'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';

/**
 * The vehicle picker lives in the header on every page.
 *
 * Not decoration: the whole product is "a part for THIS car" (PRD §74), and a
 * customer who cannot see which car is selected cannot trust what they are
 * being shown.
 */
function VehicleBar() {
  const { vehicles, selectedVehicle, selectVehicle } = useSession();

  if (vehicles.length === 0) {
    return (
      <Link className="vehicle-bar vehicle-bar-empty" href="/garage">
        + დაამატე ავტომობილი VIN-ით
      </Link>
    );
  }

  return (
    <div className="vehicle-bar">
      <span className="vehicle-bar-label">ავტომობილი</span>
      <select
        value={selectedVehicle?.id ?? ''}
        onChange={(e) => selectVehicle(e.target.value || null)}
        aria-label="აირჩიეთ ავტომობილი"
      >
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <Link className="vehicle-bar-manage" href="/garage">
        გარაჟი
      </Link>
    </div>
  );
}

function CartBadge() {
  const { api, me } = useSession();
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    if (!me) {
      setCount(0);
      return;
    }
    void api
      .cart()
      .then((cart) => setCount(cart.items.reduce((n, i) => n + i.quantity, 0)))
      .catch(() => setCount(0));
  }, [api, me, pathname]);

  return (
    <Link href="/cart" className="nav-link">
      კალათა{count > 0 ? ` (${count})` : ''}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, signOut } = useSession();
  const router = useRouter();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            autoparts
          </Link>
          <VehicleBar />
          <nav className="nav">
            {me ? (
              <>
                {me.partnerId && (
                  <Link href="/partner" className="nav-link">
                    პარტნიორი
                  </Link>
                )}
                {me.roles.some((r) => r.startsWith('PLATFORM_') || r === 'SUPER_ADMIN') && (
                  <Link href="/admin" className="nav-link">
                    ადმინი
                  </Link>
                )}
                <Link href="/orders" className="nav-link">
                  შეკვეთები
                </Link>
                <CartBadge />
                <button
                  className="nav-link nav-button"
                  onClick={async () => {
                    await signOut();
                    router.push('/');
                  }}
                >
                  გასვლა
                </button>
              </>
            ) : loading ? null : (
              <Link href="/login" className="nav-link">
                შესვლა
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="site-footer">
        <Link href="/status">build status</Link>
        <span> · </span>
        <a href="http://localhost:3001/docs" target="_blank" rel="noreferrer">
          API
        </a>
      </footer>
    </>
  );
}

/** Uniform error rendering: the API returns i18n keys, never rendered copy. */
export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useSession();
  if (!error) return null;
  const key =
    typeof error === 'object' && error !== null && 'messageKey' in error
      ? String((error as { messageKey: string }).messageKey)
      : 'error.internal';
  const details =
    typeof error === 'object' && error !== null && 'details' in error
      ? ((error as { details?: Record<string, unknown> }).details ?? null)
      : null;

  return (
    <div className="card offline" role="alert">
      <strong>{t(key)}</strong>
      {details?.['canEnterManually'] === true && (
        <p className="muted small">
          შეგიძლიათ ავტომობილი ხელით შეიყვანოთ — ჩვენ ამას ცალკე აღვნიშნავთ, რადგან
          დაუდასტურებელი მონაცემი დადასტურებულს არ უტოლდება.
        </p>
      )}
      {typeof details?.['available'] === 'number' && (
        <p className="muted small">ხელმისაწვდომია {String(details['available'])} ცალი.</p>
      )}
    </div>
  );
}

export function Spinner({ label = 'იტვირთება…' }: { label?: string }) {
  return <p className="muted">{label}</p>;
}
