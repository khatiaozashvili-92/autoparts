'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../../lib/session';
import { isSuperAdmin } from '../../../lib/workspace';
import { ErrorNote } from '../../../components/shell';

/**
 * The people who run the marketplace — the owner's page.
 *
 * A platform admin can do everything the owner can: admit partner companies,
 * approve what partners add, manage categories and stock, read every
 * transaction. Exactly one power does not delegate, and it is this one.
 * Otherwise anyone hired could hire, and the owner would lose the only
 * boundary that actually matters.
 */

interface StaffRow {
  id: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  last_login_at: string | null;
  granted_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'მფლობელი',
  PLATFORM_ADMIN: 'ადმინისტრატორი',
  PLATFORM_SUPPORT: 'მხარდაჭერა',
};

const ROLE_NOTES: Record<string, string> = {
  SUPER_ADMIN: 'ყველა უფლება, თანამშრომლების დამატების ჩათვლით',
  PLATFORM_ADMIN: 'ყველა უფლება, თანამშრომლების დამატების გარდა',
  PLATFORM_SUPPORT: 'კითხვა და თანხის დაბრუნება; ფასებს ვერ ცვლის',
};

export default function AdminStaffPage() {
  const { api, me } = useSession();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    phone: '',
    firstName: '',
    role: 'PLATFORM_ADMIN' as 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT',
  });

  const load = useCallback(async () => {
    try {
      setRows(await api.request<StaffRow[]>('/admin/staff'));
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.request<{ phone: string; role: string }>('/admin/staff', {
        method: 'POST',
        body: {
          phone: form.phone,
          firstName: form.firstName || undefined,
          role: form.role,
        },
      });
      // Nothing is sent to them, so whoever added them has to say which number.
      setNotice(
        `დაემატა. შედის ნომრით ${created.phone} — პაროლი არ არსებობს, კოდი მოვა SMS-ით.`,
      );
      setForm({ phone: '', firstName: '', role: 'PLATFORM_ADMIN' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: StaffRow) {
    const sure = window.confirm(
      `${row.first_name ?? row.phone} კარგავს ადმინ პანელს. ანგარიში რჩება — ` +
        'მომხმარებლად შესვლა კვლავ შეეძლება. გავაგრძელო?',
    );
    if (!sure) return;

    setBusy(true);
    setError(null);
    try {
      await api.request(`/admin/staff/${row.id}`, { method: 'DELETE' });
      setNotice('წვდომა გაუქმდა.');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!isSuperAdmin(me)) {
    return (
      <section className="narrow">
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            თანამშრომლების დამატება მხოლოდ მფლობელს შეუძლია. დანარჩენი ყველაფერი, რასაც
            მფლობელი აკეთებს, თქვენც შეგიძლიათ.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1 className="page-title">თანამშრომლები</h1>
      <p className="muted">
        ადმინისტრატორს ყველაფერი შეუძლია, რაც თქვენ — პარტნიორების დამატება, პროდუქციის
        დამტკიცება, კატეგორიები, მარაგი, ტრანზაქციები. <strong>ერთის გარდა:</strong> ახალ
        თანამშრომელს მხოლოდ თქვენ ამატებთ.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>ახალი თანამშრომელი</h2>
        <form className="form" onSubmit={add}>
          <div className="inline-form">
            <label>
              <span>ტელეფონი</span>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="555 12 34 56"
                required
              />
              <small className="muted">ამ ნომრით შევა.</small>
            </label>
            <label>
              <span>სახელი</span>
              <input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </label>
            <label>
              <span>უფლება</span>
              <select
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as typeof form.role })
                }
              >
                <option value="PLATFORM_ADMIN">ადმინისტრატორი</option>
                <option value="PLATFORM_SUPPORT">მხარდაჭერა</option>
              </select>
              <small className="muted">{ROLE_NOTES[form.role]}</small>
            </label>
          </div>

          <ErrorNote error={error} />
          {notice && (
            <p className="muted small" role="status" style={{ margin: 0 }}>
              {notice}
            </p>
          )}

          <button className="button primary" type="submit" disabled={busy}>
            {busy ? '…' : 'დამატება'}
          </button>
        </form>
      </div>

      <h2>ამჟამად ({rows.length})</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>ვინ</th>
              <th>ტელეფონი</th>
              <th>უფლება</th>
              <th>ბოლო შესვლა</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.id}-${row.role}`}>
                <td>
                  <strong>{row.first_name ?? '—'}</strong>
                  {row.id === me?.id && <span className="muted small"> · თქვენ</span>}
                </td>
                <td>
                  <code>{row.phone}</code>
                </td>
                <td>
                  <span
                    className={row.role === 'SUPER_ADMIN' ? 'pill pill-live' : 'pill pill-off'}
                  >
                    {ROLE_LABELS[row.role] ?? row.role}
                  </span>
                  <div className="muted small">{ROLE_NOTES[row.role]}</div>
                </td>
                <td className="muted small">
                  {row.last_login_at
                    ? new Date(row.last_login_at).toLocaleDateString('ka-GE')
                    : 'ჯერ არ შესულა'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {/*
                    An owner is not removable from a list. Demoting one is a
                    decision that should not be one click away, and removing
                    yourself could leave nobody able to get back in.
                  */}
                  {row.role !== 'SUPER_ADMIN' && (
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() => void remove(row)}
                    >
                      წვდომის გაუქმება
                    </button>
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
