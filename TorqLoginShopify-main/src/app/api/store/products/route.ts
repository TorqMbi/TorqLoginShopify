import { NextResponse } from "next/server";
import { applyCityPricing, cityPricingFor, getCustomerCity } from "@/lib/city-pricing";
import { getActiveShopifyCatalog } from "@/lib/shopify";
import { isDatabaseConfigured } from "@/lib/db";
import { getStoreAccess } from "@/lib/store-access";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Store data is temporarily unavailable." }, { status: 503 });
  }
  const access = await getStoreAccess();
  if (access.kind === "unauthenticated") {
    return NextResponse.json({ error: "Sign in to access the store." }, { status: 401 });
  }
  if (access.kind !== "approved") {
    return NextResponse.json({ error: "Store access requires an approved account." }, { status: 403 });
  }

  try {
    const [catalog, city] = await Promise.all([
      getActiveShopifyCatalog(),
      getCustomerCity(access.customerId),
    ]);
    return NextResponse.json(
      { products: applyCityPricing(catalog.products, cityPricingFor(catalog.cityPricing, city)) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // Includes an unreadable City-wise Pricing Matrix: no prices beat wrong ones.
    console.error("Approved store product request failed.", error instanceof Error ? error.name : "");
    return NextResponse.json({ error: "Products are temporarily unavailable." }, { status: 502 });
  }
}
