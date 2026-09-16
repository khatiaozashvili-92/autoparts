'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../../lib/session';
import { ErrorNote } from '../../../components/shell';

/**
 * Stock and prices.
 *
 * Two ways to change them, and both matter. The CSV is how a whole price list
 * arrives; the inline edit is how somebody fixes the one row they just found
 * wrong. A portal with only the first makes correcting a single typo a
 * spreadsheet exercise.
 */

interface PartnerProduct {
  id: string;
  name: string;
  brand: string;
  offer_id: string;
  base_price_minor: string;
  stock_quantity: number;
  currency: string;
  availability: string;
  is_stale: boolean;
  approved_at: string | null;
  active: boolean;
}

interface SyncRow {
  id: string;
  status: string;
  rows_total: number;
  rows_applied: number;
  rows_failed: number;
  created_at: string;
}

export default function PartnerStockPage() {
  const { api } = useSession();
  const [rows, setRows] = useState<PartnerProduct[]>([]);
  const [syncs, setSyncs] = useState<SyncRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Edits held per offer until saved, so typing in one row does not refetch
  // the table out from under the cursor.
  const [edits, setEdits] = useState<Record<string, { price: string; stock: string }>>({});

  const load = useCallback(async () => {
    try {
      const [products, history] = await Promise.all([
        api.request<PartnerProduct[]>('/partner/products'),
        api.request<SyncRow[]>('/partner/inventory/syncs').catch(() => [] as SyncRow[]),
      ]);
      setRows(products);
      setSyncs(history);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // FormData goes straight to fetch: the shared client always sends JSON,
      // and a multipart body is the one thing it cannot express.
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/partner/inventory/csv`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${api.tokens.getAccessToken() ?? ''}` },
          body: form,
        },
      );
      const result = (await res.json()) as {
        rowsApplied?: number;
        rowsFailed?: number;
        error?: { messageKey: string };
      };
      if (!res.ok) throw result.error ?? new Error('upload failed');
      setNotice(`${result.rowsApplied ?? 0} სტრიქონი აიტვირთა, ${result.rowsFailed ?? 0} ვერ.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function save(row: PartnerProduct) {
    const edit = edits[row.offer_id];
    if (!edit) return;
    setSavingId(row.offer_id);
    setError(null);
    try {
      await api.request(`/partner/offers/${row.offer_id}`, {
        method: 'PATCH',
        body: {
          basePriceMinor: String(Math.round(Number(edit.price) * 100)),
          stockQuantity: Number(edit.stock),
        },
      });
      setEdits((current) => {
        const next = { ...current };
        delete next[row.offer_id];
        return next;
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSavingId(null);
    }
  }

  const stale = rows.filter((r) => r.is_stale).length;

  return (
    <section>
      <h1 className="page-title">მარაგი</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>CSV ატვირთვა</h2>
        <p className="muted small">
          ფასები და მარაგი ერთ ფაილში. ატვირთვა არსებულ ნაწილებს ანახლებს — ნაცნობი OEM
          ნომრით ვცნობთ.
        </p>
        <div className="inline-form">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,text/csv"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <a className="link-button" href="/api/v1/partner/inventory/template.csv">
            შაბლონის ჩამოტვირთვა
          </a>
        </div>
        {uploading && <p className="muted small">იტვირთება…</p>}
        {notice && (
          <p className="muted small" role="status">
            {notice}
          </p>
        )}
      </div>

      {stale > 0 && (
        <div className="card offline">
          <strong>{stale} პოზიციის მარაგი მოძველებულია</strong>
          <p className="muted small" style={{ marginBottom: 0 }}>
            მოძველებული მარაგი მყიდველს ნაკლებად ენდობა — განაახლეთ, რომ რეიტინგი არ დაეცეს.
          </p>
        </div>
      )}

      <ErrorNote error={error} />

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>ნაწილი</th>
              <th style={{ textAlign: 'right' }}>ფასი (₾)</th>
              <th style={{ textAlign: 'right' }}>მარაგი</th>
              <th>სტატუსი</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  ჯერ არაფერია. ატვირთეთ CSV ან დაამატეთ ნაწილი „პროდუქციაში".
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const edit = edits[row.offer_id];
              const dirty = !!edit;
              return (
                <tr key={row.offer_id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="muted small">{row.brand}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      className="stock-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={edit?.price ?? (Number(row.base_price_minor) / 100).toFixed(2)}
                      onChange={(e) =>
                        setEdits((c) => ({
                          ...c,
                          [row.offer_id]: {
                            price: e.target.value,
                            stock: c[row.offer_id]?.stock ?? String(row.stock_quantity),
                          },
                        }))
                      }
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      className="stock-input"
                      type="number"
                      min="0"
                      value={edit?.stock ?? String(row.stock_quantity)}
                      onChange={(e) =>
                        setEdits((c) => ({
                          ...c,
                          [row.offer_id]: {
                            price:
                              c[row.offer_id]?.price ??
                              (Number(row.base_price_minor) / 100).toFixed(2),
                            stock: e.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td>
                    {!row.approved_at ? (
                      <span className="pill pill-pending">განხილვაში</span>
                    ) : row.stock_quantity > 0 ? (
                      <span className="pill pill-live">მარაგშია</span>
                    ) : (
                      <span className="pill pill-off">ამოწურულია</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="link-button"
                      disabled={!dirty || savingId === row.offer_id}
                      onClick={() => void save(row)}
                    >
                      {savingId === row.offer_id ? '…' : 'შენახვა'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {syncs.length > 0 && (
        <>
          <h2>ატვირთვების ისტორია</h2>
          <div className="table-scroll">
            <table className="data-table">
              <tbody>
                {syncs.slice(0, 8).map((sync) => (
                  <tr key={sync.id}>
                    <td>{new Date(sync.created_at).toLocaleString('ka-GE')}</td>
                    <td>{sync.status}</td>
                    <td className="muted small">
                      {sync.rows_applied}/{sync.rows_total} აიტვირთა
                      {sync.rows_failed > 0 ? `, ${sync.rows_failed} შეცდომა` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
