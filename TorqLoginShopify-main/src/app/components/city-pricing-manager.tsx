"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cityUnitPrice, toCityPricing } from "@/lib/city-pricing-rules";

type City = {
  id: string;
  name: string;
  overrides: Array<{ variantId: string; price: number }>;
  legacyAdjustmentPercent: number;
  updatedAt: string;
  updatedBy: string;
};

type Product = {
  variantId: string;
  title: string;
  sku: string;
  cartonPrice: number | null;
};

function formatRupees(amount: number): string {
  return `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(amount)}`;
}

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function samePrice(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

// How a city price compares with the Shopify price, e.g. "+Rs 600 (+5%)".
function differenceLabel(price: number, shopifyPrice: number): string {
  if (samePrice(price, shopifyPrice)) return "Same as Shopify";
  const difference = price - shopifyPrice;
  const sign = difference > 0 ? "+" : "−";
  const percent = shopifyPrice > 0
    ? ` (${sign}${Math.abs(Math.round((difference / shopifyPrice) * 1000) / 10)}%)`
    : "";
  return `${sign}${formatRupees(Math.abs(difference))}${percent}`;
}

function isInvalidPrice(value: string): boolean {
  if (!value.trim()) return false;
  const price = Number(value);
  return !Number.isFinite(price) || price <= 0;
}

async function readResult(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? fallback);
  return result;
}

export function CityPricingManager() {
  const [cities, setCities] = useState<City[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productsError, setProductsError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // Only the boxes staff have typed in; every other box shows the current price.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selected = cities.find((city) => city.id === selectedId) ?? null;
  const legacyPercent = selected?.legacyAdjustmentPercent ?? 0;
  const dirty = Object.keys(edits).length > 0;

  // What the selected city's shops pay right now, before unsaved edits.
  const savedPricing = useMemo(() => selected
    ? toCityPricing({
      name: selected.name,
      overrides: selected.overrides,
      adjustmentPercent: selected.legacyAdjustmentPercent,
    })
    : null, [selected]);

  const openCity = useCallback((city: City | null) => {
    setSelectedId(city?.id ?? "");
    setEdits({});
  }, []);

  const loadCities = useCallback(async (selectName?: string) => {
    try {
      const result = await readResult(await fetch("/admin/api/city-pricing", { cache: "no-store" }), "Unable to load city prices.");
      const loaded: City[] = result.cities;
      setCities(loaded);
      if (selectName) openCity(loaded.find((city) => city.name.toLowerCase() === selectName.toLowerCase()) ?? null);
      return loaded;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load city prices.");
      return null;
    }
  }, [openCity]);

  useEffect(() => {
    void loadCities();
    void (async () => {
      try {
        const result = await readResult(await fetch("/admin/api/city-pricing/products", { cache: "no-store" }), "Products couldn't be loaded from Shopify.");
        setProducts(result.products);
      } catch (caught) {
        setProductsError(caught instanceof Error ? caught.message : "Products couldn't be loaded from Shopify.");
      }
    })();
  }, [loadCities]);

  function boxValue(product: Product): string {
    const edit = edits[product.variantId];
    if (edit !== undefined) return edit;
    if (product.cartonPrice === null) return "";
    return String(cityUnitPrice(product.cartonPrice, product.variantId, savedPricing));
  }

  // The price a row's box stands for; an empty box means the Shopify price.
  function boxPrice(product: Product & { cartonPrice: number }): number {
    const value = boxValue(product).trim();
    return value ? Number(value) : product.cartonPrice;
  }

  const visibleProducts = (products ?? []).filter((product) => {
    const query = search.trim().toLowerCase();
    return !query || product.title.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query);
  });

  async function addCity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("new");
    setError("");
    setMessage("");
    try {
      const result = await readResult(await fetch("/admin/api/city-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      }), "Unable to create the city price list.");
      setMessage(result.message);
      const name = newName.trim().replace(/\s+/g, " ");
      setNewName("");
      await loadCities(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the city price list.");
    } finally {
      setBusy("");
    }
  }

  async function saveCity() {
    if (!selected || !products) return;
    if (Object.values(edits).some(isInvalidPrice)) {
      setError("Prices must be numbers above 0. Clear a box to use the Shopify price.");
      return;
    }
    // Start from the saved table so prices for products Shopify isn't listing
    // right now (archived, or without a carton price) are kept.
    const prices = new Map(selected.overrides.map(({ variantId, price }) => [variantId, price]));
    for (const product of products) {
      if (product.cartonPrice === null) continue;
      // Untouched rows keep what they had, except on a list that still has an
      // old %: saving fixes the prices shown in the table and drops the %.
      if (edits[product.variantId] === undefined && legacyPercent === 0) continue;
      const price = boxPrice({ ...product, cartonPrice: product.cartonPrice });
      if (samePrice(price, product.cartonPrice)) prices.delete(product.variantId);
      else prices.set(product.variantId, price);
    }

    setBusy(selected.id);
    setError("");
    setMessage("");
    try {
      const result = await readResult(await fetch(`/admin/api/city-pricing/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: [...prices].map(([variantId, price]) => ({ variantId, price })) }),
      }), "Unable to save city prices.");
      setMessage(result.message);
      await loadCities(selected.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save city prices.");
    } finally {
      setBusy("");
    }
  }

  async function deleteCity(city: City) {
    if (!window.confirm(`Delete the ${city.name} price list? Shops in ${city.name} will see standard Shopify prices.`)) return;
    setBusy(city.id);
    setError("");
    setMessage("");
    try {
      const result = await readResult(await fetch(`/admin/api/city-pricing/${city.id}`, { method: "DELETE" }), "Unable to delete the city price list.");
      setMessage(result.message);
      if (city.id === selectedId) openCity(null);
      await loadCities();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the city price list.");
    } finally {
      setBusy("");
    }
  }

  function chooseCity(city: City) {
    if (dirty && !window.confirm("You have unsaved price changes. Discard them?")) return;
    openCity(city);
    setMessage("");
    setError("");
  }

  return (
    <>
      {error && <div className="message message-error" role="alert">{error}</div>}
      {message && <div className="message message-success" role="status">{message}</div>}

      <section className="dashboard-card staff-add-card">
        <h2>Add a city</h2>
        <form className="staff-add-form city-add-form" onSubmit={(event) => void addCity(event)}>
          <label className="field">
            <span>City name</span>
            <input autoComplete="off" minLength={2} maxLength={30} required placeholder="Karachi" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <button className="button" type="submit" disabled={busy === "new"}>{busy === "new" ? "Adding…" : "Add city"}</button>
        </form>
        <p className="city-pricing-note">A new city starts with every product at its Shopify price; then change the prices you need in its table. Shops in cities without a price list pay the normal Shopify price.</p>
      </section>

      <section className="dashboard-card staff-add-card">
        <h2>City price lists</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>City</th><th>Products with a city price</th><th>Last changed</th><th>Actions</th></tr></thead>
            <tbody>
              {cities.map((city) => (
                <tr key={city.id} className={city.id === selectedId ? "city-row-selected" : undefined}>
                  <td><strong>{city.name}</strong></td>
                  <td>
                    {city.overrides.length}
                    {city.legacyAdjustmentPercent !== 0 && (
                      <span className="city-price-source city-legacy-note">Old {formatPercent(city.legacyAdjustmentPercent)} rule still on the rest. Open and save to update.</span>
                    )}
                  </td>
                  <td>{new Date(city.updatedAt).toLocaleString()} · {city.updatedBy}</td>
                  <td className="city-row-actions">
                    <button className="button button-small" type="button" disabled={Boolean(busy)} onClick={() => chooseCity(city)}>Edit prices</button>
                    <button className="button button-small button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void deleteCity(city)}>Delete</button>
                  </td>
                </tr>
              ))}
              {cities.length === 0 && <tr><td className="table-empty" colSpan={4}>No city price lists yet. Every shop sees the normal Shopify price.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="dashboard-card">
          <div className="city-editor-heading">
            <h2>{selected.name} prices</h2>
          </div>
          <p className="city-pricing-note">
            Each box shows the carton price {selected.name} shops pay now. Type a new price to change it, or clear a box to use the Shopify price.
            A product left at the Shopify price follows it if the Shopify price changes later.
          </p>
          {legacyPercent !== 0 && (
            <p className="city-legacy-warning" role="note">
              This list was set up with the old {formatPercent(legacyPercent)} rule, so the boxes show the Shopify price {formatPercent(legacyPercent)}.
              Press Save to keep these as the {selected.name} prices, or change them first. Until then, {selected.name} shops keep paying the old rule.
            </p>
          )}
          {productsError && <div className="message message-error" role="alert">{productsError} Reload the page to try again.</div>}
          {products === null && !productsError && <p className="city-pricing-note">Loading products from Shopify…</p>}
          {products !== null && (
            <>
              <input className="search-input city-product-search" type="search" placeholder="Search product or SKU" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search products" />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Product</th><th>Shopify price</th><th>{selected.name} price</th><th>Compared with Shopify</th></tr></thead>
                  <tbody>
                    {visibleProducts.map((product) => {
                      const base = product.cartonPrice;
                      const value = boxValue(product);
                      const invalid = isInvalidPrice(value);
                      const edited = edits[product.variantId] !== undefined;
                      return (
                        <tr key={product.variantId}>
                          <td><strong>{product.title}</strong>{product.sku && <span className="city-product-sku">{product.sku}</span>}</td>
                          <td>{base === null ? "—" : formatRupees(base)}</td>
                          <td>
                            {base === null ? "—" : (
                              <input
                                className="search-input city-price-input"
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                placeholder={String(base)}
                                value={value}
                                aria-label={`${selected.name} price for ${product.title}`}
                                aria-invalid={invalid}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  setEdits((current) => ({ ...current, [product.variantId]: next }));
                                }}
                              />
                            )}
                          </td>
                          <td>
                            {base === null || invalid ? "—" : differenceLabel(boxPrice({ ...product, cartonPrice: base }), base)}
                            {edited && !invalid && <span className="city-price-source">not saved yet</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {visibleProducts.length === 0 && <tr><td className="table-empty" colSpan={4}>No products match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="city-editor-actions">
            <button className="button" type="button" disabled={busy === selected.id || products === null || (!dirty && legacyPercent === 0)} onClick={() => void saveCity()}>
              {busy === selected.id ? "Saving…" : `Save ${selected.name} prices`}
            </button>
            <button className="button button-secondary" type="button" disabled={Boolean(busy) || !dirty} onClick={() => openCity(selected)}>Undo changes</button>
            {dirty && <span className="city-unsaved">Unsaved changes</span>}
          </div>
        </section>
      )}
    </>
  );
}
