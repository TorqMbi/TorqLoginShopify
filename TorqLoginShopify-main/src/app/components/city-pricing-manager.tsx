"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_ADJUSTMENT_PERCENT,
  MIN_ADJUSTMENT_PERCENT,
  cityUnitPrice,
  toCityPricing,
} from "@/lib/city-pricing-rules";

type City = {
  id: string;
  name: string;
  adjustmentPercent: number;
  overrides: Array<{ variantId: string; price: number }>;
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
  const [draftPercent, setDraftPercent] = useState("0");
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPercent, setNewPercent] = useState("0");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selected = cities.find((city) => city.id === selectedId) ?? null;

  const openCity = useCallback((city: City | null) => {
    setSelectedId(city?.id ?? "");
    setDraftPercent(String(city?.adjustmentPercent ?? 0));
    setDraftPrices(Object.fromEntries((city?.overrides ?? []).map(({ variantId, price }) => [variantId, String(price)])));
    setDirty(false);
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

  const percentValue = Number(draftPercent);
  const percentValid = draftPercent.trim() !== "" &&
    Number.isFinite(percentValue) &&
    percentValue >= MIN_ADJUSTMENT_PERCENT &&
    percentValue <= MAX_ADJUSTMENT_PERCENT;

  const preview = useMemo(() => {
    const overrides = Object.entries(draftPrices)
      .map(([variantId, value]) => ({ variantId, price: Number(value) }))
      .filter(({ price }) => Number.isFinite(price) && price > 0);
    return toCityPricing({
      name: selected?.name ?? "",
      adjustmentPercent: percentValid ? percentValue : 0,
      overrides,
    });
  }, [draftPrices, percentValid, percentValue, selected]);

  const invalidPrices = Object.values(draftPrices).filter((value) => {
    if (!value.trim()) return false;
    const price = Number(value);
    return !Number.isFinite(price) || price <= 0;
  });

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
        body: JSON.stringify({ name: newName, adjustmentPercent: Number(newPercent) }),
      }), "Unable to create the city price list.");
      setMessage(result.message);
      const name = newName.trim().replace(/\s+/g, " ");
      setNewName("");
      setNewPercent("0");
      await loadCities(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the city price list.");
    } finally {
      setBusy("");
    }
  }

  async function saveCity() {
    if (!selected) return;
    if (!percentValid) {
      setError(`Enter an adjustment between ${MIN_ADJUSTMENT_PERCENT}% and +${MAX_ADJUSTMENT_PERCENT}%.`);
      return;
    }
    if (invalidPrices.length) {
      setError("Exact prices must be numbers above 0. Clear a box to use the city adjustment instead.");
      return;
    }
    setBusy(selected.id);
    setError("");
    setMessage("");
    try {
      const overrides = Object.entries(draftPrices)
        .filter(([, value]) => value.trim() !== "")
        .map(([variantId, value]) => ({ variantId, price: Number(value) }));
      const result = await readResult(await fetch(`/admin/api/city-pricing/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustmentPercent: percentValue, overrides }),
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
          <label className="field">
            <span>Adjustment on Shopify price (%)</span>
            <input type="number" inputMode="decimal" step="0.01" min={MIN_ADJUSTMENT_PERCENT} max={MAX_ADJUSTMENT_PERCENT} required value={newPercent} onChange={(event) => setNewPercent(event.target.value)} />
          </label>
          <button className="button" type="submit" disabled={busy === "new"}>{busy === "new" ? "Adding…" : "Add city"}</button>
        </form>
        <p className="city-pricing-note">Use + for higher prices and − for lower, e.g. 5 or -3. Shops in cities without a price list see the normal Shopify price.</p>
      </section>

      <section className="dashboard-card staff-add-card">
        <h2>City price lists</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>City</th><th>Adjustment</th><th>Exact product prices</th><th>Last changed</th><th>Actions</th></tr></thead>
            <tbody>
              {cities.map((city) => (
                <tr key={city.id} className={city.id === selectedId ? "city-row-selected" : undefined}>
                  <td><strong>{city.name}</strong></td>
                  <td>{formatPercent(city.adjustmentPercent)}</td>
                  <td>{city.overrides.length}</td>
                  <td>{new Date(city.updatedAt).toLocaleString()} · {city.updatedBy}</td>
                  <td className="city-row-actions">
                    <button className="button button-small" type="button" disabled={Boolean(busy)} onClick={() => chooseCity(city)}>Edit prices</button>
                    <button className="button button-small button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void deleteCity(city)}>Delete</button>
                  </td>
                </tr>
              ))}
              {cities.length === 0 && <tr><td className="table-empty" colSpan={5}>No city price lists yet. Every shop sees the normal Shopify price.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="dashboard-card">
          <div className="city-editor-heading">
            <h2>{selected.name} prices</h2>
            <label className="field city-percent-field">
              <span>Adjustment on Shopify price (%)</span>
              <input type="number" inputMode="decimal" step="0.01" min={MIN_ADJUSTMENT_PERCENT} max={MAX_ADJUSTMENT_PERCENT} value={draftPercent} aria-invalid={!percentValid} onChange={(event) => { setDraftPercent(event.target.value); setDirty(true); }} />
            </label>
          </div>
          <p className="city-pricing-note">Type an exact carton price to override the adjustment for one product. Leave it blank to use {percentValid ? formatPercent(percentValue) : "the adjustment"}. Prices are rounded to the nearest rupee.</p>
          {productsError && <div className="message message-error" role="alert">{productsError} You can still change the adjustment.</div>}
          {products === null && !productsError && <p className="city-pricing-note">Loading products from Shopify…</p>}
          {products !== null && (
            <>
              <input className="search-input city-product-search" type="search" placeholder="Search product or SKU" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search products" />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Product</th><th>Shopify price</th><th>Exact {selected.name} price</th><th>{selected.name} shops pay</th></tr></thead>
                  <tbody>
                    {visibleProducts.map((product) => {
                      const base = product.cartonPrice;
                      const auto = base === null ? null : cityUnitPrice(base, "", preview);
                      const finalPrice = base === null ? null : cityUnitPrice(base, product.variantId, preview);
                      const value = draftPrices[product.variantId] ?? "";
                      const invalid = value.trim() !== "" && !(Number.isFinite(Number(value)) && Number(value) > 0);
                      return (
                        <tr key={product.variantId}>
                          <td><strong>{product.title}</strong>{product.sku && <span className="city-product-sku">{product.sku}</span>}</td>
                          <td>{base === null ? "—" : formatRupees(base)}</td>
                          <td>
                            <input
                              className="search-input city-price-input"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              placeholder={auto === null ? "" : String(auto)}
                              value={value}
                              aria-label={`Exact ${selected.name} price for ${product.title}`}
                              aria-invalid={invalid}
                              onChange={(event) => {
                                setDraftPrices((current) => ({ ...current, [product.variantId]: event.target.value }));
                                setDirty(true);
                              }}
                            />
                          </td>
                          <td>
                            {finalPrice === null ? "—" : formatRupees(finalPrice)}
                            <span className="city-price-source">{value.trim() ? "exact price" : `Shopify ${formatPercent(percentValid ? percentValue : 0)}`}</span>
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
            <button className="button" type="button" disabled={busy === selected.id || !dirty} onClick={() => void saveCity()}>
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
