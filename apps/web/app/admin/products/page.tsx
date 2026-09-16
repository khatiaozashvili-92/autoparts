'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../../lib/session';
import { ErrorNote } from '../../../components/shell';

/**
 * Products partners added that nobody has cleared for sale.
 *
 * This queue is the price of letting partners extend the catalogue. The
 * product's whole promise is that a customer only ever sees parts confirmed to
 * fit their exact car (ADR-004); a part the platform never curated has no
 * fitment data, so until someone establishes what it fits it cannot honestly
 * be offered to anyone. Approving is a person taking responsibility for that.
 */

interface PendingProduct {
  id: string;
  name: string;
  brand: string;
  partner: string | null;
  category_slug: string;
  master_part: string;
  created_at: string;
  fitments: string;
  offers: string;
  identifiers: string[] | null;
}

export default function AdminProductsPage() {
  const { api } = useSession();
  const [rows, setRows] = useState<PendingProduct[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.request<PendingProduct[]>('/admin/products/pending'));
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(id);
    setError(null);
    try {
      await api.request(`/admin/products/${id}/review`, { method: 'POST', body: { decision } });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h1 className="page-title">პროდუქციის განხილვა</h1>
      <p className="muted">
        პარტნიორების დამატებული ნაწილები. სანამ არ დამტკიცდება, მყიდველს არ უჩანს — ნაწილი,
        რომელზეც თავსებადობა დადგენილი არ არის, ვერცერთ მანქანას ვერ შეესაბამება.
      </p>

      <ErrorNote error={error} />

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            რიგი ცარიელია.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>ნაწილი</th>
                <th>პარტნიორი</th>
                <th>კატეგორია</th>
                <th>ნომრები</th>
                <th>თავსებადობა</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fitments = Number(row.fitments);
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="muted small">
                        {row.brand} · {row.master_part}
                      </div>
                    </td>
                    <td>{row.partner ?? '—'}</td>
                    <td>
                      <code>{row.category_slug}</code>
                    </td>
                    <td className="muted small">{(row.identifiers ?? []).join(', ') || '—'}</td>
                    <td>
                      {fitments > 0 ? (
                        <span className="pill pill-live">{fitments}</span>
                      ) : (
                        <span className="pill pill-pending">არ არის</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/*
                        Approval is disabled without fitment data rather than
                        failing on click: the API refuses it anyway, and a
                        button that always errors teaches nothing.
                      */}
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy === row.id || fitments === 0}
                        title={
                          fitments === 0
                            ? 'ჯერ თავსებადობა უნდა დადგინდეს — სხვაგვარად მყიდველი მაინც ვერ ნახავს'
                            : undefined
                        }
                        onClick={() => void review(row.id, 'APPROVE')}
                      >
                        დამტკიცება
                      </button>{' '}
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy === row.id}
                        onClick={() => void review(row.id, 'REJECT')}
                      >
                        უარყოფა
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
