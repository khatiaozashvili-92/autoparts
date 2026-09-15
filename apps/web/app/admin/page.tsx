'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote, Spinner } from '../../components/shell';

interface Conflict {
  id: string;
  product_name: string;
  brand_name: string;
  oem: string | null;
  partner_name: string | null;
  vehicle: string | null;
  engine_code: string | null;
  market: string | null;
  claimed_verdict: string;
  provider_verdict: string;
  provider_name: string | null;
  checks_last_week: string;
  offers_affected: string;
}

interface Analytics {
  funnel: Record<string, number>;
  kpis: Record<string, number | string | null>;
  alerts: { openFitmentConflicts: number };
}

const FUNNEL_LABELS: [string, string][] = [
  ['registered', 'რეგისტრირებული'],
  ['addedVehicle', 'დაამატა ავტომობილი'],
  ['searched', 'მოძებნა ნაწილი'],
  ['foundCompatible', 'იპოვა თავსებადი'],
  ['carted', 'კალათაში დაამატა'],
  ['checkout', 'checkout'],
  ['paid', 'გადაიხადა'],
  ['completed', 'დაასრულა'],
];

const ADMIN_ROLES = ['PLATFORM_SUPPORT', 'PLATFORM_ADMIN', 'SUPER_ADMIN'];

/**
 * Admin panel (docs/09).
 *
 * The conflict queue comes first and the accuracy KPIs come before revenue.
 * That ordering is the point: until conflicts are worked, R1 keeps those
 * products hidden from every customer, and Fitment Accuracy is the product's
 * first priority.
 */
export default function AdminPage() {
  const { api, me, loading: sessionLoading } = useSession();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const isAdmin = me?.roles?.some((r) => ADMIN_ROLES.includes(r)) ?? false;

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([
        api.request<Conflict[]>('/admin/fitment/conflicts'),
        api.request<Analytics>('/admin/analytics'),
      ]);
      setConflicts(c);
      setAnalytics(a);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!sessionLoading && isAdmin) void load();
    else if (!sessionLoading) setLoading(false);
  }, [isAdmin, load, sessionLoading]);

  if (sessionLoading || loading) return <Spinner />;

  if (!isAdmin) {
    return (
      <section className="hero-block">
        <h1>ადმინისტრატორის პანელი</h1>
        <p className="muted small">
          სატესტოდ შედით <code>admin@autoparts.dev</code> / <code>dev-password-change-me</code>
        </p>
      </section>
    );
  }

  async function resolve(id: string, action: string) {
    setBusy(id);
    setError(null);
    try {
      await api.request(`/admin/fitment/conflicts/${id}/resolve`, {
        method: 'POST',
        body: { action },
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const kpis = analytics?.kpis ?? {};

  return (
    <>
      <h1 className="page-title">ადმინისტრატორის პანელი</h1>
      <ErrorNote error={error} />

      {analytics && analytics.alerts.openFitmentConflicts > 0 && (
        <div className="card offline">
          <strong>{analytics.alerts.openFitmentConflicts} ღია კონფლიქტი</strong>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            სანამ არ გადაწყდება, ეს პროდუქტები ყველა მომხმარებლისგან დამალულია.
          </p>
        </div>
      )}

      <h2>თავსებადობის კონფლიქტები</h2>
      {conflicts.length === 0 ? (
        <p className="muted">ღია კონფლიქტი არ არის.</p>
      ) : (
        <div className="orders-list">
          {conflicts.map((c) => (
            <div className="card" key={c.id}>
              <div className="offer-head">
                <div>
                  <strong>{c.product_name}</strong>
                  <div className="muted small">
                    {c.brand_name}
                    {c.oem ? ` · OEM ${c.oem}` : ''}
                  </div>
                </div>
                <div className="muted small" style={{ textAlign: 'right' }}>
                  {c.checks_last_week} შემოწმება / კვირა
                  <br />
                  {c.offers_affected} შეთავაზება
                </div>
              </div>

              <p className="muted small" style={{ margin: '8px 0' }}>
                🚗 {c.vehicle ?? '—'}
                {c.engine_code ? ` · ${c.engine_code}` : ''}
                {c.market ? ` · ${c.market}` : ''}
              </p>

              <div className="conflict-claims">
                <div>
                  <span className="muted small">პარტნიორი {c.partner_name ?? '—'}</span>
                  <br />
                  <strong>{c.claimed_verdict}</strong>
                </div>
                <div>
                  <span className="muted small">{c.provider_name ?? 'provider'}</span>
                  <br />
                  <strong>{c.provider_verdict}</strong>
                </div>
              </div>

              <p className="note">
                ⚠️ პროდუქტი ამჟამად დამალულია მომხმარებლებისგან.
              </p>

              <div className="cta-row">
                <button
                  className="button primary"
                  disabled={busy === c.id}
                  onClick={() => resolve(c.id, 'approve')}
                >
                  დადასტურება
                </button>
                <button
                  className="button"
                  disabled={busy === c.id}
                  onClick={() => resolve(c.id, 'reject')}
                >
                  უარყოფა
                </button>
                <button
                  className="button"
                  disabled={busy === c.id}
                  onClick={() => resolve(c.id, 'investigate')}
                >
                  შესამოწმებელი
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2>KPI</h2>
      <div className="grid">
        {/* Accuracy first: priorities 1 and 2 (docs/01 §10). */}
        <div className="card stat">
          <div className="stat-value">
            {kpis['fitmentAccuracy'] === null ? '—' : `${kpis['fitmentAccuracy']}%`}
          </div>
          <div className="muted small">Fitment Accuracy</div>
        </div>
        <div className="card stat">
          <div className="stat-value">
            {kpis['inventoryAccuracy'] === null ? '—' : `${kpis['inventoryAccuracy']}%`}
          </div>
          <div className="muted small">Inventory Accuracy</div>
        </div>
        <div className="card stat">
          <div className="stat-value">
            {formatMoney(String(kpis['gmvMinor'] ?? '0'), 'GEL')}
          </div>
          <div className="muted small">GMV</div>
        </div>
        <div className="card stat">
          <div className="stat-value">
            {kpis['takeRate'] === null ? '—' : `${kpis['takeRate']}%`}
          </div>
          <div className="muted small">Take Rate</div>
        </div>
      </div>

      <h2>Funnel</h2>
      <div className="card">
        <dl>
          {FUNNEL_LABELS.map(([key, label], index) => {
            const value = analytics?.funnel[key] ?? 0;
            const previous =
              index === 0 ? null : (analytics?.funnel[FUNNEL_LABELS[index - 1]![0]] ?? 0);
            const drop =
              previous && previous > 0 ? Math.round((value / previous) * 100) : null;
            return (
              <div className="kv" key={key}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  {drop !== null && <span className="muted small"> · {drop}%</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </>
  );
}
