'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../../lib/session';
import { isSuperAdmin } from '../../../lib/workspace';
import { ErrorNote } from '../../../components/shell';

/**
 * Partner companies — the super admin's own page.
 *
 * A partner cannot register itself, here or anywhere: being on this
 * marketplace is a commercial relationship with an agreement behind it, so a
 * named person admits each one. That is why this page is the only way a
 * partner company comes into existence.
 */

interface PartnerRow {
  id: string;
  legal_name: string;
  display_name: string;
  status: string;
  archived_at: string | null;
  offers: string;
  orders: string;
  open_conflicts: string;
  locations: string;
}

interface PartnerUser {
  id: string;
  phone: string | null;
  first_name: string | null;
  role: string;
  last_login_at: string | null;
}

export default function AdminPartnersPage() {
  const { api, me } = useSession();
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [users, setUsers] = useState<Record<string, PartnerUser[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    legalName: '',
    displayName: '',
    taxId: '',
    adminPhone: '',
    adminFirstName: '',
  });

  const load = useCallback(async () => {
    try {
      setPartners(await api.request<PartnerRow[]>('/admin/partners'));
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPartner(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.request<{ id: string; adminPhone: string }>('/admin/partners', {
        method: 'POST',
        body: {
          legalName: form.legalName,
          displayName: form.displayName || form.legalName,
          taxId: form.taxId || undefined,
          adminPhone: form.adminPhone,
          adminFirstName: form.adminFirstName || undefined,
        },
      });
      // Said explicitly: nothing is e-mailed or texted, so whoever created the
      // company has to tell the new administrator which number to use.
      setNotice(
        `კომპანია შეიქმნა. პარტნიორის ადმინი შედის ნომრით ${created.adminPhone} — ` +
          'პაროლი არ არსებობს, კოდი SMS-ით მოდის.',
      );
      setForm({ legalName: '', displayName: '', taxId: '', adminPhone: '', adminFirstName: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function archive(partner: PartnerRow) {
    // Confirmed in the browser because it takes a company's whole catalogue
    // off the marketplace at once.
    const sure = window.confirm(
      `„${partner.display_name}" ამოირთვება: მისი შეთავაზებები ბაზრიდან ქრება და ` +
        'თანამშრომლები პორტალს კარგავენ. შეკვეთების ისტორია რჩება. გავაგრძელო?',
    );
    if (!sure) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.request<{ offersDeactivated: number; usersRevoked: number }>(
        `/admin/partners/${partner.id}`,
        { method: 'DELETE' },
      );
      setNotice(
        `ამოირთო. ${result.offersDeactivated} შეთავაზება გაითიშა, ` +
          `${result.usersRevoked} მომხმარებელს წაერთვა წვდომა.`,
      );
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleUsers(partnerId: string) {
    if (expanded === partnerId) {
      setExpanded(null);
      return;
    }
    setExpanded(partnerId);
    if (!users[partnerId]) {
      try {
        const list = await api.request<PartnerUser[]>(`/admin/partners/${partnerId}/users`);
        setUsers((current) => ({ ...current, [partnerId]: list }));
      } catch (err) {
        setError(err);
      }
    }
  }

  async function addUser(partnerId: string, phone: string) {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.request(`/admin/partners/${partnerId}/users`, {
        method: 'POST',
        body: { phone },
      });
      const list = await api.request<PartnerUser[]>(`/admin/partners/${partnerId}/users`);
      setUsers((current) => ({ ...current, [partnerId]: list }));
      setNotice(`${phone} ახლა ამ პარტნიორის ადმინია.`);
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
            პარტნიორი კომპანიების დამატება და ამორთვა მხოლოდ სუპერ-ადმინს შეუძლია.
          </p>
        </div>
      </section>
    );
  }

  const live = partners.filter((p) => !p.archived_at);
  const archived = partners.filter((p) => p.archived_at);

  return (
    <section>
      <h1 className="page-title">პარტნიორი კომპანიები</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>ახალი პარტნიორი</h2>
        <p className="muted small">
          კომპანია და მისი პირველი ადმინი ერთად იქმნება — პორტალი, რომელშიც ვერავინ შედის,
          კომპანია არ არის.
        </p>

        <form className="form" onSubmit={createPartner}>
          <div className="inline-form">
            <label>
              <span>იურიდიული სახელწოდება</span>
              <input
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                placeholder="შპს ავტო მოტორსი"
                required
              />
            </label>
            <label>
              <span>საჩვენებელი სახელი</span>
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Auto Motors"
              />
            </label>
            <label>
              <span>საიდენტიფიკაციო კოდი</span>
              <input
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                placeholder="405123456"
              />
            </label>
          </div>

          <div className="inline-form">
            <label>
              <span>ადმინის ტელეფონი</span>
              <input
                type="tel"
                value={form.adminPhone}
                onChange={(e) => setForm({ ...form, adminPhone: e.target.value })}
                placeholder="555 12 34 56"
                required
              />
              <small className="muted">ამ ნომრით შევა პარტნიორის ადმინი.</small>
            </label>
            <label>
              <span>ადმინის სახელი</span>
              <input
                value={form.adminFirstName}
                onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })}
              />
            </label>
          </div>

          <ErrorNote error={error} />
          {notice && (
            <p className="muted small" role="status" style={{ margin: 0 }}>
              {notice}
            </p>
          )}

          <button className="button primary" type="submit" disabled={busy}>
            {busy ? '…' : 'კომპანიის შექმნა'}
          </button>
        </form>
      </div>

      <h2>აქტიური ({live.length})</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>კომპანია</th>
              <th>შეთავაზება</th>
              <th>შეკვეთა</th>
              <th>კონფლიქტი</th>
              <th>ფილიალი</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  ჯერ არცერთი პარტნიორი არ არის.
                </td>
              </tr>
            )}
            {live.map((partner) => (
              <PartnerRowView
                key={partner.id}
                partner={partner}
                users={users[partner.id]}
                expanded={expanded === partner.id}
                busy={busy}
                onToggle={() => void toggleUsers(partner.id)}
                onArchive={() => void archive(partner)}
                onAddUser={(phone) => void addUser(partner.id, phone)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {archived.length > 0 && (
        <>
          <h2>ამორთული ({archived.length})</h2>
          <div className="table-scroll">
            <table className="data-table">
              <tbody>
                {archived.map((partner) => (
                  <tr key={partner.id}>
                    <td>{partner.display_name}</td>
                    <td>
                      <span className="pill pill-off">ამორთულია</span>
                    </td>
                    <td className="muted small">{partner.orders} შეკვეთა შენარჩუნებულია</td>
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

function PartnerRowView({
  partner,
  users,
  expanded,
  busy,
  onToggle,
  onArchive,
  onAddUser,
}: {
  partner: PartnerRow;
  users?: PartnerUser[];
  expanded: boolean;
  busy: boolean;
  onToggle(): void;
  onArchive(): void;
  onAddUser(phone: string): void;
}) {
  const [phone, setPhone] = useState('');

  return (
    <>
      <tr>
        <td>
          <strong>{partner.display_name}</strong>
          <div className="muted small">{partner.legal_name}</div>
        </td>
        <td>{partner.offers}</td>
        <td>{partner.orders}</td>
        <td>
          {Number(partner.open_conflicts) > 0 ? (
            <span className="pill pill-pending">{partner.open_conflicts}</span>
          ) : (
            <span className="muted">0</span>
          )}
        </td>
        <td>{partner.locations}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button type="button" className="link-button" onClick={onToggle}>
            {expanded ? 'დახურვა' : 'მომხმარებლები'}
          </button>{' '}
          <button type="button" className="link-button" onClick={onArchive} disabled={busy}>
            ამორთვა
          </button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={6} style={{ background: 'rgba(255,255,255,0.02)' }}>
            <ul className="muted small" style={{ marginTop: 0 }}>
              {(users ?? []).map((user) => (
                <li key={user.id}>
                  <code>{user.phone}</code> — {user.first_name ?? '—'} · {user.role}
                  {user.last_login_at
                    ? ` · ბოლო შესვლა ${new Date(user.last_login_at).toLocaleDateString('ka-GE')}`
                    : ' · ჯერ არ შესულა'}
                </li>
              ))}
              {users?.length === 0 && <li>ამ პარტნიორს ადმინი არ ჰყავს.</li>}
            </ul>

            <div className="inline-form">
              <label style={{ maxWidth: 220 }}>
                <span>ახალი ადმინის ნომერი</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="555 12 34 56"
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={busy || !phone.trim()}
                onClick={() => {
                  onAddUser(phone);
                  setPhone('');
                }}
              >
                დამატება
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
