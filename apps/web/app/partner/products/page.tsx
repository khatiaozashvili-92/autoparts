'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../../lib/session';
import { ErrorNote } from '../../../components/shell';

/**
 * The partner's own catalogue.
 *
 * Two ways in, because partners arrive with two different problems. A new
 * partner has a whole price list and wants it uploaded once (the CSV). An
 * established one has a part the platform does not list yet and wants to add
 * that one thing (the form).
 */

interface PartnerProduct {
  id: string;
  name: string;
  brand: string;
  category_slug: string;
  active: boolean;
  approved_at: string | null;
  offer_id: string;
  base_price_minor: string;
  stock_quantity: number;
  currency: string;
  fitments: string;
}

interface CategoryOption {
  id: string;
  slug: string;
  name: string;
}

const money = (minor: string, currency: string) =>
  `${(Number(minor) / 100).toFixed(2)} ${currency}`;

export default function PartnerProductsPage() {
  const { api } = useSession();
  const [rows, setRows] = useState<PartnerProduct[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    categorySlug: '',
    partName: '',
    brandName: '',
    productName: '',
    oem: '',
    price: '',
    stock: '0',
    sku: '',
  });

  const load = useCallback(async () => {
    try {
      const [products, cats] = await Promise.all([
        api.request<PartnerProduct[]>('/partner/products'),
        api.request<CategoryOption[]>('/categories'),
      ]);
      setRows(products);
      setCategories(cats);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProduct(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Money as minor units, never a float: 18.00 GEL is 1800, and a price
      // that went through a double would eventually be off by a tetri.
      const priceMinor = String(Math.round(Number(form.price) * 100));
      const result = await api.request<{ message: string }>('/partner/products', {
        method: 'POST',
        body: {
          categorySlug: form.categorySlug,
          partName: form.partName,
          brandName: form.brandName,
          productName: form.productName,
          identifiers: [{ kind: 'OEM', value: form.oem }],
          priceMinor,
          stockQuantity: Number(form.stock),
          partnerSku: form.sku || undefined,
        },
      });
      setNotice(result.message);
      setForm({ ...form, partName: '', productName: '', oem: '', price: '', stock: '0', sku: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const pending = rows.filter((r) => !r.approved_at);

  return (
    <section>
      <h1 className="page-title">პროდუქცია</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>მთელი კატალოგის ატვირთვა</h2>
        <p className="muted small">
          CSV ფაილი ფასებითა და მარაგით. სვეტების სახელები თქვენს კომპანიაზეა მორგებული —
          შაბლონი ზუსტად იმ ფორმატშია, რასაც ჩვენ ველოდებით.
        </p>
        <p style={{ margin: 0 }}>
          <a className="button" href="/partner/stock">
            CSV ატვირთვა და მარაგი →
          </a>
        </p>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>ცალკე ნაწილის დამატება</h2>
          <button type="button" className="link-button" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'დახურვა' : '+ დამატება'}
          </button>
        </div>

        {showForm && (
          <form className="form" onSubmit={addProduct} style={{ marginTop: 16 }}>
            <p className="muted small" style={{ marginTop: 0 }}>
              ახალი ნაწილი ჯერ ადმინის განხილვაში ხვდება. მიზეზი ერთია: სანამ არ დგინდება,
              რომელ მანქანას ერგება, მყიდველს ვერ ვაჩვენებთ — სწორედ ეს არის ჩვენი
              მთავარი დაპირება.
            </p>

            <div className="inline-form">
              <label>
                <span>კატეგორია</span>
                <select
                  value={form.categorySlug}
                  onChange={(e) => setForm({ ...form, categorySlug: e.target.value })}
                  required
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>ნაწილის ტიპი</span>
                <input
                  value={form.partName}
                  onChange={(e) => setForm({ ...form, partName: e.target.value })}
                  placeholder="სამუხრუჭე დისკი"
                  required
                />
              </label>
              <label>
                <span>ბრენდი</span>
                <input
                  value={form.brandName}
                  onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                  placeholder="Brembo"
                  required
                />
              </label>
            </div>

            <div className="inline-form">
              <label>
                <span>დასახელება</span>
                <input
                  value={form.productName}
                  onChange={(e) => setForm({ ...form, productName: e.target.value })}
                  placeholder="Brembo წინა სამუხრუჭე დისკი 320მმ"
                  required
                />
              </label>
              <label>
                <span>OEM ნომერი</span>
                <input
                  value={form.oem}
                  onChange={(e) => setForm({ ...form, oem: e.target.value })}
                  placeholder="34116850568"
                  required
                />
                <small className="muted">ამით ვცნობთ ნაწილს.</small>
              </label>
            </div>

            <div className="inline-form">
              <label>
                <span>ფასი (GEL)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                />
              </label>
              <label>
                <span>მარაგი</span>
                <input
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  required
                />
              </label>
              <label>
                <span>თქვენი SKU</span>
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
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
        )}
      </div>

      {pending.length > 0 && (
        <div className="card offline">
          <strong>{pending.length} ნაწილი განხილვაშია</strong>
          <p className="muted small" style={{ marginBottom: 0 }}>
            დამტკიცებამდე მყიდველს არ უჩანს.
          </p>
        </div>
      )}

      <h2>ყველა ({rows.length})</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>ნაწილი</th>
              <th>კატეგორია</th>
              <th style={{ textAlign: 'right' }}>ფასი</th>
              <th style={{ textAlign: 'right' }}>მარაგი</th>
              <th>სტატუსი</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  ჯერ არაფერი გაქვთ ატვირთული.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.offer_id}>
                <td>
                  <strong>{row.name}</strong>
                  <div className="muted small">{row.brand}</div>
                </td>
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
                  ) : row.active ? (
                    <span className="pill pill-live">ცოცხალი</span>
                  ) : (
                    <span className="pill pill-off">გამორთული</span>
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
