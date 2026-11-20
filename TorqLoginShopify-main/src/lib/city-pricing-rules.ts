import type { ShopifyStoreProduct } from "@/lib/shopify";

// City pricing: admins give each city a percentage adjustment on the Shopify
// price, plus optional exact prices for single products. Customers see the
// price list of the city saved on their shop details; a city without a price
// list gets the normal Shopify price.

export const CITY_PRICES_COLLECTION = "city_prices";
export const MIN_ADJUSTMENT_PERCENT = -50;
export const MAX_ADJUSTMENT_PERCENT = 100;
export const MAX_CITY_PRICE = 100_000_000;
export const MAX_PRICE_OVERRIDES = 2_000;
export const CITY_LOCKED_MESSAGE =
  "Your prices depend on your city, so it can't be changed after your account is approved. Please contact us on WhatsApp to change it.";

const VARIANT_ID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
// Letters first, then letters, spaces, dots, apostrophes or hyphens; 2–30 characters.
const CITY_NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'-]{1,29}$/u;

export type CityPriceOverride = { variantId: string; price: number };

export type CityPricing = {
  name: string;
  adjustmentPercent: number;
  overrides: ReadonlyMap<string, number>;
};

export function cityKey(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

export function cleanCityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return CITY_NAME_PATTERN.test(name) ? name : null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseAdjustmentPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_ADJUSTMENT_PERCENT || value > MAX_ADJUSTMENT_PERCENT) return null;
  return roundToCents(value);
}

export function parseCityPrice(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > MAX_CITY_PRICE) return null;
  return roundToCents(value);
}

export function parsePriceOverrides(value: unknown): CityPriceOverride[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRICE_OVERRIDES) return null;
  const seen = new Set<string>();
  const overrides: CityPriceOverride[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { variantId, price } = entry as Record<string, unknown>;
    if (typeof variantId !== "string" || !VARIANT_ID_PATTERN.test(variantId) || seen.has(variantId)) {
      return null;
    }
    const parsedPrice = parseCityPrice(price);
    if (parsedPrice === null) return null;
    seen.add(variantId);
    overrides.push({ variantId, price: parsedPrice });
  }
  return overrides;
}

export function toCityPricing(document: {
  name: string;
  adjustmentPercent: number;
  overrides: CityPriceOverride[];
}): CityPricing {
  return {
    name: document.name,
    adjustmentPercent: document.adjustmentPercent,
    overrides: new Map(document.overrides.map(({ variantId, price }) => [variantId, price])),
  };
}

// An exact product price wins; otherwise the city's percentage is applied to
// the Shopify price and rounded to the nearest rupee.
export function cityUnitPrice(
  basePrice: number,
  variantId: string,
  pricing: CityPricing | null,
): number {
  if (!pricing) return basePrice;
  const override = pricing.overrides.get(variantId);
  if (override !== undefined) return override;
  if (pricing.adjustmentPercent === 0) return basePrice;
  return Math.max(0, Math.round((basePrice * (100 + pricing.adjustmentPercent)) / 100));
}

export function applyCityPricing(
  products: ShopifyStoreProduct[],
  pricing: CityPricing | null,
): ShopifyStoreProduct[] {
  if (!pricing) return products;
  return products.map((product) => {
    if (product.cartonPrice === null) return product;
    const cartonPrice = cityUnitPrice(product.cartonPrice, product.variantId, pricing);
    return {
      ...product,
      cartonPrice,
      pricePerPiece: product.piecesPerCarton !== null
        ? Math.round(cartonPrice / product.piecesPerCarton)
        : null,
    };
  });
}
