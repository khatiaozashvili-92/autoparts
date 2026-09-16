'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../../lib/session';
import { ErrorNote } from '../../../components/shell';

/**
 * Stock across the whole marketplace.
 *
 * Read-only, deliberately. Staff need to see what the marketplace actually has
 * — what is stale, what has run out, which partner is not keeping up — but a
 * price belongs to the partner who set it. An admin quietly editing one would
 * leave that partner selling at a number they never agreed to, and the first
 * they would know of it is a customer arriving to collect.
 */

interface InventoryRow {
  offer_id: string;
  product: string;
  brand: string;
  partner: string;
  category_slug: string;
  base_price_minor: string;
  currency: string;
  stock_quantity: number;
  is_stale: boolean;
  approved_at: string | null;
  last_synced_at: string | null;
}

interface Summary {
  offers: string;
  out_of_stock: string;
  stale: string;
  partners: string;
  pending_products: string;
}

const money = (minor: string, currency: string) =>
  `${(Number(minor) / 100).toFixed(2)} ${currency}`;

export default function AdminInventoryPage() {
  const { api } = useSession();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (staleOnly) params.set('stale', 'true');
      const [list, totals] = await Promise.all([
        api.request<InventoryRow[]>(`/admin/inventory?${params}`),
        api.request<Summary>('/admin/inventory/summary'),
      ]);
      setRows(list);
      setSummary(totals);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [api, search, staleOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h1 className="page-title">მარაგები</h1>
      <p className="muted">
        მთელი ბაზრის მარაგი, ერთ სიაში. ფასს აქედან ვერ შეცვლით — ის პარტნიორისაა.
      </p>

      {summary && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{summary.offers}</div>
            <div className="muted small">შეთავაზება</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.partners}</div>
            <div className="muted small">პარტნიორი</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.out_of_stock}</div>
            <div className="muted small">ამოწურული</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.stale}</div>
            <div className="muted small">მოძველებული მარაგი</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.pending_products}</div>
            <div className="muted small">განხილვის მოლოდინში</div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="inline-form">
          <label>
            <span>ძებნა</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ნაწილი ან პარტნიორი"
            />
          </label>
          <label style={{ flex: '0 0 auto' }}>
            <span>ფილტრი</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={staleOnly}
                onChange={(e) => setStaleOnly(e.target.checked)}
              />
              <span className="muted small">მხოლოდ მოძველებული</span>
            </span>
          </label>
          <button type="button" className="button" onClick={() => void load()} disabled={busy}>
            {busy ? '…' : 'ჩვენება'}
          </button>
        </div>
      </div>

      <ErrorNote error={error} />

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>ნაწილი</th>
              <th>პარტნიორი</th>
              <th>კატეგორია</th>
              <th style={{ textAlign: 'right' }}>ფასი</th>
              <th style={{ textAlign: 'right' }}>მარაგი</th>
              <th>მდგომარეობა</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  არაფერი მოიძებნა.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.offer_id}>
                <td>
                  <strong>{row.product}</strong>
                  <div className="muted small">{row.brand}</div>
                </td>
                <td>{row.partner}</td>
                <td>
                  <code>{row.category_slug}</code>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {money(row.base_price_minor, row.currency)}
                </td>
                <td style={{ textAlign: 'right' }}>{row.stock_quantity}</td>
                <td>
                  {!row.approved_at ? (
                    <span className="pill pill-pending">განხილვაში</span>
                  ) : row.is_stale ? (
                    <span className="pill pill-pending">მოძველებული</span>
                  ) : row.stock_quantity === 0 ? (
                    <span className="pill pill-off">ამოწურული</span>
                  ) : (
                    <span className="pill pill-live">მარაგშია</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
