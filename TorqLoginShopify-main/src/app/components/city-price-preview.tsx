"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PreviewCity = { name: string; province: string; adjustmentPercent: number };
type Preview = {
  matrixSaved: boolean;
  useDefaultPrices: boolean;
  cities: PreviewCity[];
  city: { name: string; adjustmentPercent: number; applied: boolean } | null;
  products: Array<{
    variantId: string;
    title: string;
    sku: string;
    shopifyPrice: number | null;
    cityPrice: number | null;
  }>;
};

function formatRupees(amount: number | null): string {
  return amount === null ? "—" : `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(amount)}`;
}

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function byProvince(cities: PreviewCity[]): Array<[string, PreviewCity[]]> {
  const groups = new Map<string, PreviewCity[]>();
  for (const city of cities) {
    const province = city.province || "Other";
    groups.set(province, [...(groups.get(province) ?? []), city]);
  }
  return [...groups];
}

// Admin-only: pick a city and see what its shops pay for every product. Each
// change asks the server, which uses the matrix saved in Shopify right now.
export function CityPricePreview({ initialCity, initialCities }: { initialCity: string; initialCities: PreviewCity[] }) {
  const [city, setCity] = useState(initialCity);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/admin/api/city-pricing/preview?city=${encodeURIComponent(city)}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "The price preview couldn't be loaded.");
        if (requestId === latestRequest.current) setPreview(result as Preview);
      } catch (caught) {
        if (requestId === latestRequest.current) {
          setError(caught instanceof Error ? caught.message : "The price preview couldn't be loaded.");
        }
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    })();
  }, [city]);

  const cities = preview?.cities ?? initialCities;
  const shown = preview?.city?.name === city || !preview ? preview : null;
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (shown?.products ?? []).filter((product) =>
      !query || product.title.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query));
  }, [shown, search]);

  const selected = shown?.city ?? null;
  const adjustmentLabel = selected
    ? `${formatPercent(selected.adjustmentPercent)}${selected.adjustmentPercent !== 0 && !selected.applied ? " (not applied)" : ""}`
    : "0%";

  return (
    <section className="dashboard-card staff-add-card">
      <h2>Price preview by city</h2>
      <p className="city-pricing-note">
        Pick a city to see what its shops pay. Prices use the adjustment saved in Shopify right now; the Shopify product
        prices themselves don&apos;t change. Only administrators can see this.
      </p>
      <div className="city-preview-controls">
        <label className="field city-preview-city">
          <span>City</span>
          <select value={city} onChange={(event) => setCity(event.target.value)}>
            {byProvince(cities).map(([province, list]) => (
              <optgroup key={province} label={province}>
                {list.map((entry) => (
                  <option key={entry.name} value={entry.name}>{entry.name} ({formatPercent(entry.adjustmentPercent)})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <input className="search-input city-preview-search" type="search" placeholder="Search product or SKU" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search products" />
      </div>

      {error && <div className="message message-error" role="alert">{error}</div>}
      {selected && (
        <p className="city-preview-summary" role="status">
          {shown?.useDefaultPrices
            ? `"Use default prices" is on in Shopify, so ${selected.name} shops pay the normal Shopify price (their ${formatPercent(selected.adjustmentPercent)} is not applied).`
            : selected.adjustmentPercent === 0
              ? `${selected.name} shops pay the normal Shopify price (0%).`
              : `${selected.name} shops pay the Shopify price ${formatPercent(selected.adjustmentPercent)}.`}
        </p>
      )}

      <div className="table-wrap" aria-busy={loading}>
        <table>
          <thead>
            <tr><th>Product</th><th>SKU</th><th>Shopify price</th><th>Adjustment</th><th>{selected?.name ?? city} price</th></tr>
          </thead>
          <tbody>
            {loading && !shown && <tr><td className="table-empty" colSpan={5}>Loading prices from Shopify…</td></tr>}
            {visibleProducts.map((product) => (
              <tr key={product.variantId}>
                <td><strong>{product.title}</strong></td>
                <td>{product.sku || "—"}</td>
                <td>{formatRupees(product.shopifyPrice)}</td>
                <td>{product.shopifyPrice === null ? "—" : adjustmentLabel}</td>
                <td><strong>{formatRupees(product.cityPrice)}</strong></td>
              </tr>
            ))}
            {shown && visibleProducts.length === 0 && <tr><td className="table-empty" colSpan={5}>No products match.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
