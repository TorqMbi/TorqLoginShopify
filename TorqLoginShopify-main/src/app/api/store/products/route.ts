import { NextResponse } from "next/server";
import { applyCityPricing, getCustomerCityPricing } from "@/lib/city-pricing";
import { getActiveShopifyProducts } from "@/lib/shopify";
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
    const [products, cityPricing] = await Promise.all([
      getActiveShopifyProducts(),
      getCustomerCityPricing(access.customerId),
    ]);
    return NextResponse.json(
      { products: applyCityPricing(products, cityPricing) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    console.error("Approved store product request failed.");
    return NextResponse.json({ error: "Products are temporarily unavailable." }, { status: 502 });
  }
}
