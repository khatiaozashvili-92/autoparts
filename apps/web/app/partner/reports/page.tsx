'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../../lib/session';
import { ErrorNote } from '../../../components/shell';

/**
 * What this partner sold.
 *
 * Their revenue only: the platform's markup is excluded everywhere here,
 * because it was never theirs. Showing a bigger number than the one they will
 * be paid would make this report worse than useless at reconciliation time.
 */

interface SalesReport {
  range: { from: string | null; to: string | null };
  totals: { orders: string; units: string; revenue_minor: string; platform_markup_minor: string };
  daily: { day: string; orders: string; revenue_minor: string }[];
  topProducts: { id: string; name: string; brand: string; units: string; revenue_minor: string }[];
}

const money = (minor: string | number) => `${(Number(minor) / 100).toFixed(2)} ₾`;

/** Default window: the last 30 days, which is how a shop thinks about a month. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function PartnerReportsPage() {
  const { api } = useSession();
  const [range, setRange] = useState(defaultRange);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      setReport(await api.request<SalesReport>(`/partner/reports/sales?${params}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [api, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const peak = Math.max(1, ...(report?.daily ?? []).map((d) => Number(d.revenue_minor)));

  return (
    <section>
      <h1 className="page-title">გაყიდვები</h1>

      <div className="card">
        <div className="inline-form">
          <label>
            <span>დან</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </label>
          <label>
            <span>მდე</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </label>
          <button type="button" className="button" onClick={() => void load()} disabled={busy}>
            {busy ? '…' : 'ჩვენება'}
          </button>
        </div>
      </div>

      <ErrorNote error={error} />

      {report && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{report.totals.orders}</div>
              <div className="muted small">შეკვეთა</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{report.totals.units}</div>
              <div className="muted small">გაყიდული ერთეული</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{money(report.totals.revenue_minor)}</div>
              <div className="muted small">თქვენი შემოსავალი</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{money(report.totals.platform_markup_minor)}</div>
              <div className="muted small">პლატფორმის საკომისიო</div>
            </div>
          </div>

          <h2>დღეების მიხედვით</h2>
          {report.daily.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                ამ პერიოდში გაყიდვა არ ყოფილა.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>დღე</th>
                    <th style={{ textAlign: 'right' }}>შეკვეთა</th>
                    <th style={{ textAlign: 'right' }}>შემოსავალი</th>
                    <th style={{ width: '40%' }} />
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((day) => (
                    <tr key={day.day}>
                      <td>{day.day}</td>
                      <td style={{ textAlign: 'right' }}>{day.orders}</td>
                      <td style={{ textAlign: 'right' }}>{money(day.revenue_minor)}</td>
                      <td>
                        {/*
                          A bar rather than a chart library: one number per row
                          compared against the best day is the whole question,
                          and it stays readable on a phone.
                        */}
                        <div
                          aria-hidden
                          style={{
                            height: 8,
                            borderRadius: 4,
                            background: 'var(--accent)',
                            opacity: 0.75,
                            width: `${(Number(day.revenue_minor) / peak) * 100}%`,
                            minWidth: 2,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>ყველაზე გაყიდვადი</h2>
          {report.topProducts.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                ჯერ მონაცემი არ არის.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ნაწილი</th>
                    <th style={{ textAlign: 'right' }}>ერთეული</th>
                    <th style={{ textAlign: 'right' }}>შემოსავალი</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topProducts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="muted small">{p.brand}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{p.units}</td>
                      <td style={{ textAlign: 'right' }}>{money(p.revenue_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
