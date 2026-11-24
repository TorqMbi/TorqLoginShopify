import { NextResponse } from "next/server";
import { authorizeStaff } from "@/lib/admin-api";
import {
  CityPricingUnavailableError,
  applyCityPricing,
  cityPricingFor,
  findMatrixCity,
} from "@/lib/city-pricing-rules";
import { getActiveShopifyCatalog } from "@/lib/shopify";

// Admin-only preview of what shops in one city pay. It reads the products and
// the City-wise Pricing Matrix fresh from Shopify and prices them with the
// same function as the store, so the preview always matches what shops see.
export async function GET(request: Request) {
  const authorization = await authorizeStaff("admin");
  if (authorization.response) return authorization.response;
  const city = new URL(request.url).searchParams.get("city")?.slice(0, 100) ?? "";

  try {
    const { products, cityPricing: matrix } = await getActiveShopifyCatalog();
    const entry = findMatrixCity(matrix, city);
    const pricing = cityPricingFor(matrix, city);
    const priced = applyCityPricing(products, pricing);
    return NextResponse.json({
      matrixSaved: matrix !== null,
      useDefaultPrices: matrix?.useDefaultPrices ?? false,
      cities: (matrix?.cities ?? []).map(({ name, province, adjustmentPercent }) => ({ name, province, adjustmentPercent })),
      city: entry ? { name: entry.name, adjustmentPercent: entry.adjustmentPercent, applied: pricing !== null } : null,
      products: products.map((product, index) => ({
        variantId: product.variantId,
        title: product.title,
        sku: product.sku,
        shopifyPrice: product.cartonPrice,
        cityPrice: priced[index].cartonPrice,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CityPricingUnavailableError) {
      console.error("City price preview: matrix unreadable.", error.message);
      return NextResponse.json(
        { error: "The City-wise Pricing Matrix saved in Shopify couldn't be read. Open TORQ City Pricing in Shopify and save it again." },
        { status: 503 },
      );
    }
    console.error("City price preview failed.", error instanceof Error ? error.name : "");
    return NextResponse.json({ error: "Products couldn't be loaded from Shopify. Please try again." }, { status: 502 });
  }
}
