import { redirect } from "next/navigation";
import { Storefront } from "@/app/components/storefront";
import { getCustomerHeaderCustomer } from "@/app/components/store-chrome";
import { applyCityPricing, cityPricingFor, getCustomerCity } from "@/lib/city-pricing";
import { getActiveShopifyCatalog, type ShopifyStoreProduct } from "@/lib/shopify";
import { isDatabaseConfigured } from "@/lib/db";
import { getStoreAccess } from "@/lib/store-access";
import { AccountStatusSync } from "@/app/components/account-status-sync";

export const dynamic = "force-dynamic";

export default async function StorePage() {
  if (!isDatabaseConfigured()) redirect("/login");
  const access = await getStoreAccess();
  if (access.kind === "unauthenticated") redirect("/login");
  if (access.kind === "incomplete") redirect("/account/details");
  if (access.kind !== "approved") redirect("/dashboard");
  const customer = await getCustomerHeaderCustomer();

  let products: ShopifyStoreProduct[] | null = null;
  try {
    const [catalog, city] = await Promise.all([
      getActiveShopifyCatalog(),
      getCustomerCity(access.customerId),
    ]);
    products = applyCityPricing(catalog.products, cityPricingFor(catalog.cityPricing, city));
  } catch (error) {
    // Includes an unreadable City-wise Pricing Matrix: no prices beat wrong ones.
    console.error("Approved store page product request failed.", error instanceof Error ? error.name : "");
  }

  return (
    <>
      <AccountStatusSync initialStatus="approved" />
      <Storefront products={products} customer={customer} />
    </>
  );
}
