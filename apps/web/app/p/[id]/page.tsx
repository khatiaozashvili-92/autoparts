import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ProductDetail } from '@autoparts/api-client';
import { ProductOffers } from './offers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/**
 * Product page — server-rendered (docs/12 §4).
 *
 * This is the page search engines land on, and the one a visitor with no
 * account reaches first. The product's identity — name, brand, OEM number —
 * therefore comes from the server, while everything that depends on knowing
 * the visitor's car (fitment, offers, the buy button) is hydrated on the
 * client, because the API cannot answer those without a vehicle.
 */
async function fetchProduct(id: string): Promise<ProductDetail | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/products/${id}`, {
      headers: { 'accept-language': 'ka' },
      next: { revalidate: 60 },
    });
    return res.ok ? ((await res.json()) as ProductDetail) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const product = await fetchProduct((await params).id);
  if (!product) return { title: 'ნაწილი ვერ მოიძებნა — autoparts' };

  const oem = product.identifiers.find((i) => i.kind === 'OEM')?.value;
  return {
    title: `${product.name}${oem ? ` — OEM ${oem}` : ''} | autoparts`,
    description: `${product.masterPart.name} · ${product.brand.name}${
      oem ? ` · OEM ${oem}` : ''
    }. შეამოწმეთ თავსებადობა თქვენს ავტომობილთან და შეადარეთ პარტნიორების ფასები.`,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await fetchProduct(id);
  if (!product) notFound();

  const oem = product.identifiers.find((i) => i.kind === 'OEM');

  return (
    <>
      <script
        type="application/ld+json"
        // Structured data so the listing can appear as a product in search
        // results rather than a bare link (docs/12 §4).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            brand: { '@type': 'Brand', name: product.brand.name },
            ...(oem ? { mpn: oem.value } : {}),
            category: product.masterPart.categorySlug,
          }),
        }}
      />

      <h1 className="page-title">{product.name}</h1>

      <div className="card">
        <dl>
          <div className="kv">
            <dt>ბრენდი</dt>
            <dd>
              {product.brand.name}
              {product.brand.type === 'UNKNOWN' && (
                <span className="muted"> · უცნობი ბრენდი</span>
              )}
            </dd>
          </div>
          <div className="kv">
            <dt>ნაწილი</dt>
            <dd>{product.masterPart.name}</dd>
          </div>
          {product.identifiers.map((identifier) => (
            <div className="kv" key={`${identifier.kind}-${identifier.value}`}>
              <dt>{identifier.kind}</dt>
              <dd className="mono">{identifier.value}</dd>
            </div>
          ))}
          <div className="kv">
            <dt>მდგომარეობა</dt>
            <dd>ახალი</dd>
          </div>
          {product.warrantyMonths && (
            <div className="kv">
              <dt>გარანტია</dt>
              <dd>{product.warrantyMonths} თვე</dd>
            </div>
          )}
        </dl>
      </div>

      <ProductOffers productId={id} />
    </>
  );
}
