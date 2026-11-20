import { NextResponse } from "next/server";
import { authorizeStaff } from "@/lib/admin-api";
import { getActiveShopifyProducts } from "@/lib/shopify";

// The product list the City pricing screen prices against: the same active
// Shopify products and carton prices customers see.
export async function GET() {
  const authorization = await authorizeStaff("admin");
  if (authorization.response) return authorization.response;
  try {
    const products = await getActiveShopifyProducts();
    return NextResponse.json({
      products: products.map((product) => ({
        variantId: product.variantId,
        title: product.title,
        sku: product.sku,
        cartonPrice: product.cartonPrice,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("City pricing product request failed.");
    return NextResponse.json({ error: "Products couldn't be loaded from Shopify. Please try again." }, { status: 502 });
  }
}
