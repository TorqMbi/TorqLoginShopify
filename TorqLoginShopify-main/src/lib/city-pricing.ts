import type { Db, ObjectId } from "mongodb";
import { getDatabase, type CustomerDocument } from "@/lib/db";
import {
  CITY_LOCKED_MESSAGE,
  cityKey,
  findMatrixCity,
  type CityPricingMatrix,
} from "@/lib/city-pricing-rules";
import { getShopifyCityPricingMatrix } from "@/lib/shopify";

// Server side of city pricing. The rules live in city-pricing-rules.ts; the
// prices themselves come from the City-wise Pricing Matrix in Shopify.
export * from "@/lib/city-pricing-rules";

const CITY_CHECK_FAILED_MESSAGE =
  "We couldn't check city prices right now, so your city wasn't changed. Please try again in a few minutes.";

export async function getCustomerCity(customerId: ObjectId): Promise<string> {
  const database = await getDatabase();
  const customer = await database.collection<CustomerDocument>("customers").findOne(
    { _id: customerId },
    { projection: { "shop_details.city": 1 } },
  );
  return customer?.shop_details?.city ?? "";
}

// The matrix's spelling of a city (e.g. "karachi " -> "Karachi"), or null if
// the city isn't listed or Shopify can't be reached right now.
export async function findListedCityName(city: string): Promise<string | null> {
  try {
    return findMatrixCity(await getShopifyCityPricingMatrix(), city)?.name ?? null;
  } catch (error) {
    console.error("City pricing matrix could not be read.", error instanceof Error ? error.message : "");
    return null;
  }
}

// One line for staff on the customer review page: what this shop pays.
export async function describeCityPrices(city: string): Promise<string> {
  let matrix: CityPricingMatrix | null;
  try {
    matrix = await getShopifyCityPricingMatrix();
  } catch (error) {
    console.error("City pricing matrix could not be read.", error instanceof Error ? error.message : "");
    return "Couldn't load city prices from Shopify right now";
  }
  if (!matrix) return "Shopify prices (the City-wise Pricing Matrix hasn't been saved in Shopify yet)";
  if (matrix.useDefaultPrices) return "Shopify prices (\"Use default prices\" is on in TORQ City Pricing)";
  const entry = findMatrixCity(matrix, city);
  if (!entry) return "Shopify prices (this city isn't in the City-wise Pricing Matrix)";
  if (entry.adjustmentPercent === 0) return `${entry.name}: Shopify prices (0% in the City-wise Pricing Matrix)`;
  const sign = entry.adjustmentPercent > 0 ? "+" : "";
  return `${entry.name}: Shopify prices ${sign}${entry.adjustmentPercent}% (City-wise Pricing Matrix)`;
}

function cityPercent(matrix: CityPricingMatrix | null, city: unknown): number {
  return findMatrixCity(matrix, city)?.adjustmentPercent ?? 0;
}

// Decides which city to save from the shop details form. A listed city is
// saved under the matrix's spelling. Once an account is approved, a change to
// a city with a different % is refused, so customers cannot pick a cheaper
// city themselves; staff can set the account back to pending instead.
export async function resolveDetailsCity(
  database: Db,
  customerId: ObjectId,
  requestedCity: string,
): Promise<{ city: string } | { error: string }> {
  const customer = await database.collection<CustomerDocument>("customers").findOne(
    { _id: customerId },
    { projection: { "shop_details.status": 1, "shop_details.city": 1 } },
  );
  const approved = customer?.shop_details?.status === "approved";

  let matrix: CityPricingMatrix | null;
  try {
    matrix = await getShopifyCityPricingMatrix();
  } catch (error) {
    console.error("City pricing matrix could not be read.", error instanceof Error ? error.message : "");
    if (!approved) return { city: requestedCity };
    // An approved shop keeping its city is fine; a change can't be checked.
    return cityKey(customer?.shop_details?.city) === cityKey(requestedCity)
      ? { city: customer?.shop_details?.city ?? requestedCity }
      : { error: CITY_CHECK_FAILED_MESSAGE };
  }

  const city = findMatrixCity(matrix, requestedCity)?.name ?? requestedCity;
  if (!approved) return { city };
  const currentCity = customer?.shop_details?.city;
  if (cityKey(currentCity) === cityKey(city)) return { city };
  return cityPercent(matrix, currentCity) === cityPercent(matrix, city)
    ? { city }
    : { error: CITY_LOCKED_MESSAGE };
}
