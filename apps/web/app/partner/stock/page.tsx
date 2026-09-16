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
  const [rowErrors, setRowErrors] = useState<{ row: number; column: string; message: string }[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Off by default: the everyday use of this page is reposting a price list,
  // where an unmatched row is almost always a typo in a part number.
  const [createMissing, setCreateMissing] = useState(false);
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
      form.append('createMissing', String(createMissing));
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
        rowsOk?: number;
        rowsFailed?: number;
        createdProducts?: number;
        errors?: { row: number; column: string; message: string }[];
        error?: { messageKey: string };
      };
      if (!res.ok) throw result.error ?? new Error('upload failed');
      setNotice(
        `${result.rowsOk ?? 0} სტრიქონი აიტვირთა` +
          (result.createdProducts
            ? `, მათგან ${result.createdProducts} ახალი პროდუქტი — განხილვის მოლოდინშია`
            : '') +
          (result.rowsFailed ? `. ${result.rowsFailed} ვერ აიტვირთა.` : '.'),
      );
      setRowErrors(result.errors ?? []);
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
          <a
            className="link-button"
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/partner/inventory/template.csv`}
          >
            შაბლონის ჩამოტვირთვა
          </a>
        </div>

        {/*
          Off by default, and deliberately so. Reposting a price list is the
          daily use of this page, and there an unmatched row is nearly always a
          mistyped part number — creating products for those would fill the
          catalogue with misspelled duplicates nobody can find. Loading a
          catalogue is the rarer, deliberate act, so it is the one you ask for.
        */}
        <label
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14 }}
        >
          <input
            type="checkbox"
            checked={createMissing}
            onChange={(e) => setCreateMissing(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>ახალი პროდუქტებიც დაამატე</strong>
            <span className="muted small" style={{ display: 'block' }}>
              მონიშნეთ პირველი ატვირთვისას, როცა კატალოგს სრულად აწყობთ. მაშინ ფაილს
              სჭირდება <code>category</code> სვეტიც. ახალი პროდუქტი განხილვის მოლოდინში
              ხვდება — მყიდველს დამტკიცებამდე არ უჩანს.
            </span>
          </span>
        </label>

        {uploading && <p className="muted small">იტვირთება…</p>}
        {notice && (
          <p className="muted small" role="status">
            {notice}
          </p>
        )}

        {/*
          Row-level errors, with the line number. A summary that only says
          "12 rows failed" sends somebody hunting through a spreadsheet.
        */}
        {rowErrors.length > 0 && (
          <div className="card offline" style={{ marginTop: 12 }}>
            <strong>{rowErrors.length} სტრიქონი ვერ აიტვირთა</strong>
            <ul className="muted small" style={{ marginBottom: 0 }}>
              {rowErrors.slice(0, 12).map((e, i) => (
                <li key={i}>
                  სტრიქონი {e.row} · <code>{e.column}</code> — {e.message}
                </li>
              ))}
              {rowErrors.length > 12 && <li>…და კიდევ {rowErrors.length - 12}</li>}
            </ul>
          </div>
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
