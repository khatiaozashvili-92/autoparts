'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../../lib/session';
import { ErrorNote } from '../../../components/shell';

/**
 * Categories — the platform's, never a partner's.
 *
 * A category is not a label. `required_vehicle_attributes` is what the Fitment
 * Engine reads to know which facts about a car it must have before it can
 * decide anything in that category (docs/05 §4): brakes need the brake
 * configuration, engine parts need the engine code. A category configured with
 * the wrong list makes every part in it either undecidable or wrongly
 * confident, which is why partners cannot create one.
 */

interface CategoryRow {
  id: string;
  slug: string;
  active: boolean;
  sort_order: number;
  required_vehicle_attributes: string[];
  name_ka: string | null;
  name_en: string | null;
  master_parts: string;
  active_products: string;
}

export default function AdminCategoriesPage() {
  const { api } = useSession();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ slug: '', nameKa: '', nameEn: '', attributes: '' });

  const load = useCallback(async () => {
    try {
      setRows(await api.request<CategoryRow[]>('/admin/categories'));
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.request('/admin/categories', {
        method: 'POST',
        body: {
          slug: form.slug,
          nameKa: form.nameKa,
          nameEn: form.nameEn,
          requiredVehicleAttributes: form.attributes
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
        },
      });
      setForm({ slug: '', nameKa: '', nameEn: '', attributes: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function setActive(row: CategoryRow, active: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.request(`/admin/categories/${row.id}`, { method: 'PATCH', body: { active } });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1 className="page-title">კატეგორიები</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>ახალი კატეგორია</h2>
        <p className="muted small">
          „საჭირო ატრიბუტები" განსაზღვრავს, რა უნდა ვიცოდეთ მანქანაზე, სანამ ამ კატეგორიაში
          თავსებადობას გადავწყვეტთ. არასწორი სია ან ყველაფერს დაუდასტურებელს ხდის, ან ცრუ
          დარწმუნებას იძლევა.
        </p>

        <form className="form" onSubmit={create}>
          <div className="inline-form">
            <label>
              <span>slug</span>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="suspension"
                pattern="[a-z0-9-]+"
                required
              />
            </label>
            <label>
              <span>სახელი (ka)</span>
              <input
                value={form.nameKa}
                onChange={(e) => setForm({ ...form, nameKa: e.target.value })}
                placeholder="საკიდარი"
                required
              />
            </label>
            <label>
              <span>სახელი (en)</span>
              <input
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                placeholder="Suspension"
                required
              />
            </label>
          </div>

          <label>
            <span>საჭირო ატრიბუტები (მძიმით)</span>
            <input
              value={form.attributes}
              onChange={(e) => setForm({ ...form, attributes: e.target.value })}
              placeholder="engine_code, drivetrain"
            />
          </label>

          <ErrorNote error={error} />
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? '…' : 'დამატება'}
          </button>
        </form>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>კატეგორია</th>
              <th>slug</th>
              <th>საჭირო ატრიბუტები</th>
              <th>ნაწილი</th>
              <th>პროდუქტი</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name_ka ?? row.slug}</strong>
                  <div className="muted small">{row.name_en}</div>
                </td>
                <td>
                  <code>{row.slug}</code>
                </td>
                <td className="muted small">
                  {row.required_vehicle_attributes.length > 0
                    ? row.required_vehicle_attributes.join(', ')
                    : '—'}
                </td>
                <td>{row.master_parts}</td>
                <td>{row.active_products}</td>
                <td style={{ textAlign: 'right' }}>
                  {row.active ? (
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() => void setActive(row, false)}
                    >
                      გამორთვა
                    </button>
                  ) : (
                    <>
                      <span className="pill pill-off">გამორთული</span>{' '}
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() => void setActive(row, true)}
                      >
                        ჩართვა
                      </button>
                    </>
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
