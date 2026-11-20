import type { Db, ObjectId } from "mongodb";
import { getDatabase, type CityPriceDocument, type CustomerDocument } from "@/lib/db";
import {
  CITY_LOCKED_MESSAGE,
  CITY_PRICES_COLLECTION,
  cityKey,
  toCityPricing,
  type CityPricing,
} from "@/lib/city-pricing-rules";

// Database side of city pricing. The pricing rules themselves live in
// city-pricing-rules.ts so the admin screen can preview prices in the browser.
export * from "@/lib/city-pricing-rules";

export async function findCityPricing(database: Db, city: unknown): Promise<CityPricing | null> {
  const key = cityKey(city);
  if (!key) return null;
  const document = await database
    .collection<CityPriceDocument>(CITY_PRICES_COLLECTION)
    .findOne({ nameKey: key });
  return document ? toCityPricing(document) : null;
}

export async function getCustomerCityPricing(customerId: ObjectId): Promise<CityPricing | null> {
  const database = await getDatabase();
  const customer = await database.collection<CustomerDocument>("customers").findOne(
    { _id: customerId },
    { projection: { "shop_details.city": 1 } },
  );
  return findCityPricing(database, customer?.shop_details?.city);
}

export async function listPricedCityNames(database: Db): Promise<string[]> {
  const cities = await database
    .collection<CityPriceDocument>(CITY_PRICES_COLLECTION)
    .find({}, { projection: { name: 1 } })
    .sort({ nameKey: 1 })
    .toArray();
  return cities.map((city) => city.name);
}

// Decides which city to save from the shop details form. A city with a price
// list is saved under its listed spelling. Once an account is approved, a
// change that would move it to a different price list is refused, so
// customers cannot pick a cheaper city themselves.
export async function resolveDetailsCity(
  database: Db,
  customerId: ObjectId,
  requestedCity: string,
): Promise<{ city: string } | { error: string }> {
  const prices = database.collection<CityPriceDocument>(CITY_PRICES_COLLECTION);
  const [customer, requested] = await Promise.all([
    database.collection<CustomerDocument>("customers").findOne(
      { _id: customerId },
      { projection: { "shop_details.status": 1, "shop_details.city": 1 } },
    ),
    prices.findOne({ nameKey: cityKey(requestedCity) }, { projection: { name: 1 } }),
  ]);
  const city = requested?.name ?? requestedCity;
  if (customer?.shop_details?.status !== "approved") return { city };

  const currentKey = cityKey(customer.shop_details.city);
  if (currentKey === cityKey(city)) return { city };
  const current = currentKey
    ? await prices.findOne({ nameKey: currentKey }, { projection: { _id: 1 } })
    : null;
  const samePriceList = String(current?._id ?? "standard") === String(requested?._id ?? "standard");
  return samePriceList ? { city } : { error: CITY_LOCKED_MESSAGE };
}
