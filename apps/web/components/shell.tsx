'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { homeFor, navFor, showsVehicleBar, workspaceOf } from '../lib/workspace';

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

/** Says whose interface this is, so a shared browser cannot mislead anyone. */
const WORKSPACE_LABEL = {
  customer: null,
  partner: 'პარტნიორი',
  admin: 'ადმინისტრირება',
} as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const workspace = workspaceOf(me);
  const badge = WORKSPACE_LABEL[workspace];
  const items = navFor(me);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={homeFor(me)} className="brand">
            autoparts
            {badge && <span className="workspace-badge">{badge}</span>}
          </Link>

          {/*
            Only the customer gets the car picker. A partner keeping their
            stock up to date and an admin approving a product have no car in
            this product, and a header that implies otherwise is clutter that
            makes the tool look like it was built for someone else.
          */}
          {showsVehicleBar(me) && <VehicleBar />}

          <nav className="nav">
            {me ? (
              <>
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      pathname === item.href || pathname.startsWith(item.href + '/')
                        ? 'nav-link nav-link-active'
                        : 'nav-link'
                    }
                  >
                    {item.label}
                  </Link>
                ))}
                {workspace === 'customer' && <CartBadge />}
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
        {/* The public origin, not localhost: this link is followed by whoever
            is looking at the page, wherever it is deployed. */}
        <a
          href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/docs`}
          target="_blank"
          rel="noreferrer"
        >
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
