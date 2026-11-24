import type { ShopifyStoreProduct } from "@/lib/shopify";

// City pricing is managed in Shopify admin by the "TORQ City Pricing" app
// (City-wise Pricing Matrix), which saves its setup as JSON in the shop
// metafield torq.city_pricing. The portal only reads it: a shop pays the
// Shopify price plus its city's adjustment %. Cities not in the matrix, and
// every city while "Use default prices" is on, pay the plain Shopify price.

export const CITY_PRICING_NAMESPACE = "torq";
export const CITY_PRICING_KEY = "city_pricing";
// Customer-facing wording never mentions city pricing: customers only see
// their final price as the normal selling price.
export const CITY_LOCKED_MESSAGE =
  "Your city can't be changed after your account is approved. Please contact us on WhatsApp to change it.";
export const CITY_PRICING_UNAVAILABLE_MESSAGE =
  "Prices couldn't be loaded right now. Your cart is safe; please try again in a few minutes.";

// Adjustments outside this range are treated as a broken matrix rather than
// charged, e.g. -100% would make products free.
const MIN_ADJUSTMENT_PERCENT = -99;
const MAX_ADJUSTMENT_PERCENT = 1000;

export type CityPricingCity = {
  name: string;
  province: string;
  group: string;
  adjustmentPercent: number;
};

export type CityPricingMatrix = {
  useDefaultPrices: boolean;
  baseCity: string;
  cities: CityPricingCity[];
  updatedAt: string | null;
};

// The adjustment that applies to one shop.
export type CityPricing = { name: string; adjustmentPercent: number };

export class CityPricingUnavailableError extends Error {
  constructor(detail: string) {
    super(`City pricing matrix is unreadable: ${detail}`);
    this.name = "CityPricingUnavailableError";
  }
}

export function cityKey(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

// Reads the metafield value. Returns null when the matrix has never been
// saved (everyone pays Shopify prices) and throws when it is malformed, so a
// broken matrix stops orders instead of silently charging the wrong price.
export function parseCityPricingMatrix(
  value: string | null | undefined,
  updatedAt: string | null = null,
): CityPricingMatrix | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    throw new CityPricingUnavailableError("not valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CityPricingUnavailableError("not an object");
  }
  const { useDefaultPrices, baseCity, cities } = data as Record<string, unknown>;
  if (useDefaultPrices !== undefined && typeof useDefaultPrices !== "boolean") {
    throw new CityPricingUnavailableError("useDefaultPrices is not true or false");
  }
  if (!Array.isArray(cities)) throw new CityPricingUnavailableError("cities is not a list");

  const seen = new Set<string>();
  const parsed: CityPricingCity[] = [];
  for (const entry of cities) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CityPricingUnavailableError("a city entry is not an object");
    }
    const city = entry as Record<string, unknown>;
    const name = text(city.name);
    if (!name) throw new CityPricingUnavailableError("a city has no name");
    const adjustment = city.adjustment ?? 0;
    if (
      typeof adjustment !== "number" ||
      !Number.isFinite(adjustment) ||
      adjustment < MIN_ADJUSTMENT_PERCENT ||
      adjustment > MAX_ADJUSTMENT_PERCENT
    ) {
      throw new CityPricingUnavailableError(`${name} has an invalid adjustment`);
    }
    // The first entry wins if a city is listed twice.
    if (seen.has(cityKey(name))) continue;
    seen.add(cityKey(name));
    parsed.push({ name, province: text(city.province), group: text(city.group), adjustmentPercent: adjustment });
  }
  return { useDefaultPrices: useDefaultPrices === true, baseCity: text(baseCity), cities: parsed, updatedAt };
}

export function findMatrixCity(matrix: CityPricingMatrix | null, city: unknown): CityPricingCity | null {
  const key = cityKey(city);
  if (!matrix || !key) return null;
  return matrix.cities.find((entry) => cityKey(entry.name) === key) ?? null;
}

// The % a shop in this city pays on top of Shopify prices, or null when it
// pays plain Shopify prices.
export function cityPricingFor(matrix: CityPricingMatrix | null, city: unknown): CityPricing | null {
  if (!matrix || matrix.useDefaultPrices) return null;
  const entry = findMatrixCity(matrix, city);
  if (!entry || entry.adjustmentPercent === 0) return null;
  return { name: entry.name, adjustmentPercent: entry.adjustmentPercent };
}

// Shopify price plus the city's %, rounded to the nearest rupee.
export function cityUnitPrice(basePrice: number, pricing: CityPricing | null): number {
  if (!pricing) return basePrice;
  return Math.max(0, Math.round((basePrice * (100 + pricing.adjustmentPercent)) / 100));
}

export function applyCityPricing(
  products: ShopifyStoreProduct[],
  pricing: CityPricing | null,
): ShopifyStoreProduct[] {
  if (!pricing) return products;
  return products.map((product) => {
    if (product.cartonPrice === null) return product;
    const cartonPrice = cityUnitPrice(product.cartonPrice, pricing);
    return {
      ...product,
      cartonPrice,
      pricePerPiece: product.piecesPerCarton !== null
        ? Math.round(cartonPrice / product.piecesPerCarton)
        : null,
    };
  });
}

// Matrix cities grouped by province, in the matrix's order, for city pickers.
export function cityChoices(matrix: CityPricingMatrix | null): Array<{ province: string; cities: string[] }> {
  const groups = new Map<string, string[]>();
  for (const city of matrix?.cities ?? []) {
    const province = city.province || "Other";
    groups.set(province, [...(groups.get(province) ?? []), city.name]);
  }
  return [...groups].map(([province, cities]) => ({ province, cities }));
}
