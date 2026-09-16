'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { ErrorNote } from './shell';

/**
 * Transaction history, shared by all three workspaces.
 *
 * One component rather than three, because the three audiences are looking at
 * the same events and must never be shown different numbers for them. What
 * differs is only the scope of the endpoint and whether the platform's
 * commission column exists at all — and that is decided by the API, not here:
 * a customer's response simply has no commission in it.
 */

export interface TransactionRow {
  id: string;
  kind: 'PAYMENT' | 'REFUND';
  at: string;
  order_id: string;
  order_number: string;
  amount_minor: string;
  currency: string;
  status: string;
  commission_minor: string | null;
  reason: string | null;
  partner: string | null;
  customer_phone: string | null;
}

interface Summary {
  transactions: number;
  paidMinor: string;
  refundedMinor: string;
  netMinor: string;
  commissionMinor?: string;
}

const money = (minor: string | number) => {
  const n = Number(minor) / 100;
  return `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} ₾`;
};

const STATUS_LABELS: Record<string, string> = {
  CAPTURED: 'ჩარიცხული',
  AUTHORIZED: 'დაჯავშნილი',
  PENDING: 'მუშავდება',
  FAILED: 'ვერ შესრულდა',
  REFUNDED: 'დაბრუნებული',
};

const REASON_LABELS: Record<string, string> = {
  CUSTOMER_CANCEL: 'მყიდველმა გააუქმა',
  NO_SHOW: 'არ გამოცხადდა',
  STOCK_FAILURE: 'მარაგი არ აღმოჩნდა',
  ADMIN: 'ადმინისტრატორი',
  PARTNER_REJECTED: 'გამყიდველმა ვერ შეასრულა',
};

/** Last 30 days: the window a shop thinks in. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function TransactionHistory({
  endpoint,
  showPartner = false,
  showCustomer = false,
}: {
  endpoint: string;
  /** Who sold it — meaningless in the partner's own view. */
  showPartner?: boolean;
  /** Who bought it — platform staff only. */
  showCustomer?: boolean;
}) {
  const { api } = useSession();
  const [range, setRange] = useState(defaultRange);
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const result = await api.request<{ summary: Summary; data: TransactionRow[] }>(
        `${endpoint}?${params}`,
      );
      setRows(result.data);
      setSummary(result.summary);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [api, endpoint, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h1 className="page-title">ტრანზაქციები</h1>

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

      {summary && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{summary.transactions}</div>
            <div className="muted small">ტრანზაქცია</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{money(summary.paidMinor)}</div>
            <div className="muted small">ჩარიცხული</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{money(summary.refundedMinor)}</div>
            <div className="muted small">დაბრუნებული</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{money(summary.netMinor)}</div>
            <div className="muted small">სხვაობა</div>
          </div>
          {/*
            Only the platform response carries this at all, so the tile simply
            does not exist for the other two rather than being hidden by CSS.
          */}
          {summary.commissionMinor !== undefined && (
            <div className="stat-card">
              <div className="stat-value">{money(summary.commissionMinor)}</div>
              <div className="muted small">პლატფორმის საკომისიო</div>
            </div>
          )}
        </div>
      )}

      <ErrorNote error={error} />

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>თარიღი</th>
              <th>შეკვეთა</th>
              <th>ტიპი</th>
              {showPartner && <th>გამყიდველი</th>}
              {showCustomer && <th>მყიდველი</th>}
              <th style={{ textAlign: 'right' }}>თანხა</th>
              {summary?.commissionMinor !== undefined && (
                <th style={{ textAlign: 'right' }}>საკომისიო</th>
              )}
              <th>სტატუსი</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  ამ პერიოდში ტრანზაქცია არ ყოფილა.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`}>
                <td className="muted small">
                  {new Date(row.at).toLocaleString('ka-GE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td>
                  <code>{row.order_number}</code>
                </td>
                <td>
                  {row.kind === 'PAYMENT' ? (
                    <span className="pill pill-live">გადახდა</span>
                  ) : (
                    <span className="pill pill-pending">დაბრუნება</span>
                  )}
                  {row.reason && (
                    <div className="muted small">{REASON_LABELS[row.reason] ?? row.reason}</div>
                  )}
                </td>
                {showPartner && <td>{row.partner ?? '—'}</td>}
                {showCustomer && <td className="mono small">{row.customer_phone ?? '—'}</td>}
                <td
                  style={{
                    textAlign: 'right',
                    fontWeight: 600,
                    // A refund reads as money leaving, so it is coloured like
                    // one rather than sitting in the same black as a sale.
                    color: row.kind === 'REFUND' ? 'var(--heading)' : undefined,
                  }}
                >
                  {money(row.amount_minor)}
                </td>
                {summary?.commissionMinor !== undefined && (
                  <td style={{ textAlign: 'right' }} className="muted">
                    {row.commission_minor ? money(row.commission_minor) : '—'}
                  </td>
                )}
                <td className="muted small">{STATUS_LABELS[row.status] ?? row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
