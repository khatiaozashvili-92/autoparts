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
 *
 * Which is why declaring the fitment happens here, in the same row as the
 * decision. Approval needs fitment data and a partner upload never has any, so
 * a panel that only offered the two buttons left the reviewer with exactly one
 * usable exit -- refusal -- and no way to see that the other one was a
 * requirement rather than a fault.
 */

interface Fitment {
  id: string;
  make: string;
  model: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

interface ReviewProduct {
  id: string;
  name: string;
  brand: string;
  partner: string | null;
  category_slug: string;
  master_part: string;
  created_at: string;
  rejected_at: string | null;
  review_note: string | null;
  fitments: string;
  offers: string;
  identifiers: string[] | null;
  fitment_list: Fitment[] | null;
}

interface MakeOption {
  make: string;
  models: string[];
}

/** "Toyota Corolla 2005-2012", or as much of it as was stated. */
function describeFitment(f: Fitment): string {
  const years =
    f.yearFrom && f.yearTo
      ? `${f.yearFrom}-${f.yearTo}`
      : f.yearFrom
        ? `${f.yearFrom}+`
        : f.yearTo
          ? `-${f.yearTo}`
          : '';
  return [f.make, f.model ?? 'ყველა მოდელი', years].filter(Boolean).join(' ');
}

export default function AdminProductsPage() {
  const { api } = useSession();
  const [rows, setRows] = useState<ReviewProduct[]>([]);
  const [rejected, setRejected] = useState<ReviewProduct[]>([]);
  const [options, setOptions] = useState<MakeOption[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Which row has its fitment form open. One at a time: the form is wide and
  // the reviewer is working through the list one product at a time anyway.
  const [openFor, setOpenFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pending, refused, makes] = await Promise.all([
        api.request<ReviewProduct[]>('/admin/products/pending'),
        api.request<ReviewProduct[]>('/admin/products/rejected').catch(() => [] as ReviewProduct[]),
        api.request<MakeOption[]>('/admin/fitment/vehicle-options').catch(() => [] as MakeOption[]),
      ]);
      setRows(pending);
      setRejected(refused);
      setOptions(makes);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(row: ReviewProduct, decision: 'APPROVE' | 'REJECT' | 'RESTORE') {
    // A refusal the partner cannot read is a refusal they can only answer by
    // uploading the same file again.
    let note: string | undefined;
    if (decision === 'REJECT') {
      const reason = window.prompt(
        `რატომ არ მტკიცდება „${row.name}"? მიზეზს პარტნიორი დაინახავს.`,
        '',
      );
      if (reason === null) return;
      note = reason.trim() || undefined;
    }

    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await api.request(`/admin/products/${row.id}/review`, {
        method: 'POST',
        body: { decision, ...(note ? { note } : {}) },
      });
      setNotice(
        decision === 'APPROVE'
          ? `„${row.name}" დამტკიცდა — მყიდველს უკვე უჩანს.`
          : decision === 'REJECT'
            ? `„${row.name}" უარყოფილია.`
            : `„${row.name}" რიგში დაბრუნდა.`,
      );
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function addFitment(row: ReviewProduct, form: HTMLFormElement) {
    const data = new FormData(form);
    const make = String(data.get('make') ?? '').trim();
    if (!make) return;
    const model = String(data.get('model') ?? '').trim();
    const yearFrom = String(data.get('yearFrom') ?? '').trim();
    const yearTo = String(data.get('yearTo') ?? '').trim();

    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await api.request(`/admin/products/${row.id}/fitments`, {
        method: 'POST',
        body: {
          make,
          ...(model ? { model } : {}),
          ...(yearFrom ? { yearFrom: Number(yearFrom) } : {}),
          ...(yearTo ? { yearTo: Number(yearTo) } : {}),
        },
      });
      form.reset();
      setNotice(`თავსებადობა დაემატა — ახლა „${row.name}" დამტკიცებადია.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function removeFitment(row: ReviewProduct, fitmentId: string) {
    setBusy(row.id);
    setError(null);
    try {
      await api.request(`/admin/products/${row.id}/fitments/${fitmentId}`, { method: 'DELETE' });
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
        რომელზეც თავსებადობა დადგენილი არ არის, ვერცერთ მანქანას ვერ შეესაბამება. ამიტომ
        დამტკიცებამდე მიუთითეთ, რომელ ავტომობილს უხდება.
      </p>

      <ErrorNote error={error} />
      {notice && (
        <p className="muted small" role="status">
          {notice}
        </p>
      )}

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
                const fitments = row.fitment_list ?? [];
                const canApprove = fitments.length > 0;
                const open = openFor === row.id;
                return (
                  <FragmentRow key={row.id}>
                    <tr>
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
                        {fitments.length === 0 ? (
                          <span className="pill pill-pending">არ არის</span>
                        ) : (
                          <ul className="fitment-list">
                            {fitments.map((f) => (
                              <li key={f.id}>
                                <span className="pill pill-live">{describeFitment(f)}</span>{' '}
                                <button
                                  type="button"
                                  className="link-button"
                                  disabled={busy === row.id}
                                  onClick={() => void removeFitment(row, f.id)}
                                  title="თავსებადობის მოხსნა"
                                >
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setOpenFor(open ? null : row.id)}
                        >
                          {open ? 'დახურვა' : '+ ავტომობილის მითითება'}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {/*
                          Approval stays disabled without fitment data — the API
                          refuses it anyway — but the reason is now actionable:
                          the form that fixes it is one click away in this row.
                        */}
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy === row.id || !canApprove}
                          title={
                            canApprove
                              ? undefined
                              : 'ჯერ მიუთითეთ, რომელ ავტომობილს უხდება — სხვაგვარად მყიდველი მაინც ვერ ნახავს'
                          }
                          onClick={() => void review(row, 'APPROVE')}
                        >
                          დამტკიცება
                        </button>{' '}
                        <button
                          type="button"
                          className="link-button danger"
                          disabled={busy === row.id}
                          onClick={() => void review(row, 'REJECT')}
                        >
                          უარყოფა
                        </button>
                      </td>
                    </tr>

                    {open && (
                      <tr>
                        <td colSpan={6} className="review-form-cell">
                          <form
                            className="inline-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void addFitment(row, e.currentTarget);
                            }}
                          >
                            {/*
                              A list, not free text, wherever we can: "Toyota"
                              and "TOYOTA" are one car, but "Toyta" is none, and
                              a fitment nobody's vehicle matches looks exactly
                              like no fitment at all.
                            */}
                            <label>
                              მარკა
                              <input name="make" list="known-makes" required placeholder="Toyota" />
                            </label>
                            <label>
                              მოდელი
                              <input name="model" list="known-models" placeholder="ყველა მოდელი" />
                            </label>
                            <label>
                              წლიდან
                              <input name="yearFrom" type="number" min={1950} max={2100} placeholder="2005" />
                            </label>
                            <label>
                              წლამდე
                              <input name="yearTo" type="number" min={1950} max={2100} placeholder="2012" />
                            </label>
                            <button type="submit" className="button primary" disabled={busy === row.id}>
                              დამატება
                            </button>
                          </form>
                          <p className="muted small" style={{ marginBottom: 0 }}>
                            მოდელი და წლები არასავალდებულოა — ცარიელი ველი ნიშნავს „ყველას".
                          </p>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Shared by every row's two inputs; the browser filters as you type. */}
      <datalist id="known-makes">
        {options.map((o) => (
          <option key={o.make} value={o.make} />
        ))}
      </datalist>
      <datalist id="known-models">
        {options.flatMap((o) => o.models.map((m) => <option key={`${o.make}-${m}`} value={m} />))}
      </datalist>

      {rejected.length > 0 && (
        <>
          <h2>უარყოფილი</h2>
          <p className="muted small">
            უარყოფა საბოლოო არაა — რიგში დაბრუნება ნიშნავს, რომ პროდუქტი ისევ განსახილველი ხდება.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ნაწილი</th>
                  <th>პარტნიორი</th>
                  <th>მიზეზი</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rejected.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="muted small">{row.brand}</div>
                    </td>
                    <td>{row.partner ?? '—'}</td>
                    <td className="muted small">{row.review_note || '— (მიზეზი არ მითითებულა)'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy === row.id}
                        onClick={() => void review(row, 'RESTORE')}
                      >
                        რიგში დაბრუნება
                      </button>
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

/**
 * Two sibling `<tr>`s from one map, without wrapping them in anything a table
 * would reject. `<>…</>` would do, but naming it keeps the row markup above
 * readable about why the product row and its form are siblings.
 */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
