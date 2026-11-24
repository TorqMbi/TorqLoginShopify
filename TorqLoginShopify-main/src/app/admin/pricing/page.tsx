import { redirect } from "next/navigation";
import { AdminHeader } from "@/app/components/admin-header";
import { CityPricePreview } from "@/app/components/city-price-preview";
import type { CityPricingMatrix } from "@/lib/city-pricing-rules";
import { getShopifyCityPricingMatrix } from "@/lib/shopify";
import { getStaffSession } from "@/lib/staff-auth";

export const dynamic = "force-dynamic";

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function shopifyAppsUrl(): string | null {
  const handle = process.env.SHOPIFY_STORE_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\.myshopify\.com\/?$/, "");
  return handle && /^[a-z0-9-]+$/i.test(handle) ? `https://admin.shopify.com/store/${handle}/apps` : null;
}

async function loadMatrix(): Promise<{ matrix: CityPricingMatrix | null } | { error: true }> {
  try {
    return { matrix: await getShopifyCityPricingMatrix() };
  } catch (error) {
    console.error("City pricing matrix could not be read.", error instanceof Error ? error.message : "");
    return { error: true };
  }
}

// View-only: city prices are edited in the TORQ City Pricing app in Shopify.
export default async function CityPricingPage() {
  const staff = await getStaffSession();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "admin") redirect("/admin");

  const loaded = await loadMatrix();
  const appsUrl = shopifyAppsUrl();
  const matrix = "matrix" in loaded ? loaded.matrix : null;
  const adjusted = matrix?.cities.filter((city) => city.adjustmentPercent !== 0) ?? [];
  const standard = matrix?.cities.filter((city) => city.adjustmentPercent === 0) ?? [];

  return (
    <main className="app-page">
      <AdminHeader staff={staff} />
      <section className="content-wrap">
        <div className="page-heading">
          <h1>City pricing</h1>
          <p>
            Prices come from the City-wise Pricing Matrix in the TORQ City Pricing app in Shopify admin. A shop pays the
            Shopify price plus its city&apos;s %. Changes saved there apply to new orders straight away.
          </p>
        </div>

        <section className="dashboard-card staff-add-card city-matrix-summary">
          <div className="city-matrix-heading">
            <h2>From Shopify</h2>
            {appsUrl && (
              <a className="button button-small" href={appsUrl} target="_blank" rel="noreferrer">
                Edit in Shopify (Apps → TORQ City Pricing)
              </a>
            )}
          </div>
          {"error" in loaded ? (
            <div className="message message-error" role="alert">
              City prices couldn&apos;t be loaded from Shopify. Shops can&apos;t see prices or order until this works again. Reload to retry.
            </div>
          ) : !matrix ? (
            <p className="city-pricing-note">The matrix hasn&apos;t been saved in Shopify yet, so every shop pays the normal Shopify price.</p>
          ) : (
            <dl className="city-matrix-facts">
              <div>
                <dt>Use default prices</dt>
                <dd>{matrix.useDefaultPrices ? "On: every shop pays the normal Shopify price" : "Off: city % below apply"}</dd>
              </div>
              <div><dt>Base city</dt><dd>{matrix.baseCity || "—"}</dd></div>
              <div>
                <dt>Last saved in Shopify</dt>
                <dd>{matrix.updatedAt ? new Date(matrix.updatedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" }) : "—"}</dd>
              </div>
            </dl>
          )}
        </section>

        {matrix && matrix.cities.length > 0 && (
          <CityPricePreview
            initialCity={(adjusted[0] ?? matrix.cities[0]).name}
            initialCities={matrix.cities.map(({ name, province, adjustmentPercent }) => ({ name, province, adjustmentPercent }))}
          />
        )}

        {matrix && (
          <section className="dashboard-card staff-add-card">
            <h2>Cities with a city %</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>City</th><th>Province</th><th>Group</th><th>Adjustment</th><th>Rs 10,000 product costs</th></tr></thead>
                <tbody>
                  {adjusted.map((city) => (
                    <tr key={city.name}>
                      <td><strong>{city.name}</strong></td>
                      <td>{city.province || "—"}</td>
                      <td>{city.group || "—"}</td>
                      <td>{formatPercent(city.adjustmentPercent)}{matrix.useDefaultPrices && <span className="city-price-source">not applied: default prices on</span>}</td>
                      <td>Rs {new Intl.NumberFormat("en-PK").format(Math.round(100 * (100 + city.adjustmentPercent)))}</td>
                    </tr>
                  ))}
                  {adjusted.length === 0 && <tr><td className="table-empty" colSpan={5}>No city has a % yet. Every shop pays the Shopify price.</td></tr>}
                </tbody>
              </table>
            </div>
            {standard.length > 0 && (
              <details className="city-matrix-standard">
                <summary>{standard.length} other cities pay the Shopify price (0%)</summary>
                <p>{standard.map((city) => city.name).join(", ")}</p>
              </details>
            )}
            <p className="city-pricing-note">Shops in cities that aren&apos;t in the matrix also pay the Shopify price.</p>
          </section>
        )}
      </section>
    </main>
  );
}
