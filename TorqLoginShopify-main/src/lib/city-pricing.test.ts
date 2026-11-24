import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getShopifyCityPricingMatrix: vi.fn() }));
const shopifyDown = async () => {
  throw new Error("Shopify down");
};
vi.mock("@/lib/db", () => ({ getDatabase: vi.fn() }));
vi.mock("@/lib/shopify", () => ({ getShopifyCityPricingMatrix: mocks.getShopifyCityPricingMatrix }));

import {
  CITY_LOCKED_MESSAGE,
  CityPricingUnavailableError,
  applyCityPricing,
  cityChoices,
  cityKey,
  cityPricingFor,
  cityUnitPrice,
  describeCityPrices,
  findListedCityName,
  parseCityPricingMatrix,
  resolveDetailsCity,
  type CityPricingMatrix,
} from "./city-pricing";
import type { ShopifyStoreProduct } from "./shopify";

// The shape TORQ City Pricing saves in the shop metafield torq.city_pricing.
const SAVED_MATRIX = JSON.stringify({
  useDefaultPrices: false,
  baseCity: "Lahore",
  groups: [],
  cities: [
    { name: "Lahore", province: "Punjab", group: "", adjustment: 10 },
    { name: "Faisalabad", province: "Punjab", group: "", adjustment: 10 },
    { name: "Multan", province: "Punjab", group: "", adjustment: 0 },
    { name: "Karachi", province: "Sindh", group: "Coast", adjustment: -3 },
  ],
});

function matrix(overrides: Partial<CityPricingMatrix> = {}): CityPricingMatrix {
  return { ...parseCityPricingMatrix(SAVED_MATRIX)!, ...overrides };
}

describe("reading the City-wise Pricing Matrix", () => {
  it("reads the matrix TORQ City Pricing saves", () => {
    const parsed = parseCityPricingMatrix(SAVED_MATRIX, "2026-11-24T10:14:02Z");
    expect(parsed).toMatchObject({ useDefaultPrices: false, baseCity: "Lahore", updatedAt: "2026-11-24T10:14:02Z" });
    expect(parsed!.cities[0]).toEqual({ name: "Lahore", province: "Punjab", group: "", adjustmentPercent: 10 });
    expect(parsed!.cities).toHaveLength(4);
  });

  it("treats a matrix that was never saved as no city prices", () => {
    expect(parseCityPricingMatrix(null)).toBeNull();
    expect(parseCityPricingMatrix(undefined)).toBeNull();
    expect(parseCityPricingMatrix("  ")).toBeNull();
  });

  it("tidies names, defaults a missing % to 0 and keeps the first of a duplicate city", () => {
    const parsed = parseCityPricingMatrix(JSON.stringify({
      cities: [
        { name: "  Dera   Ghazi Khan ", province: "Punjab" },
        { name: "lahore", adjustment: 5 },
        { name: "Lahore", adjustment: 50 },
      ],
    }));
    expect(parsed!.cities).toEqual([
      { name: "Dera Ghazi Khan", province: "Punjab", group: "", adjustmentPercent: 0 },
      { name: "lahore", province: "", group: "", adjustmentPercent: 5 },
    ]);
    expect(parsed!.useDefaultPrices).toBe(false);
  });

  it("refuses a broken matrix instead of guessing prices", () => {
    for (const value of [
      "{not json",
      "[]",
      JSON.stringify({ cities: "Lahore" }),
      JSON.stringify({ useDefaultPrices: "yes", cities: [] }),
      JSON.stringify({ cities: [{ name: "", adjustment: 10 }] }),
      JSON.stringify({ cities: [{ name: "Lahore", adjustment: "10" }] }),
      JSON.stringify({ cities: [{ name: "Lahore", adjustment: -100 }] }),
      JSON.stringify({ cities: [{ name: "Lahore", adjustment: 1001 }] }),
    ]) {
      expect(() => parseCityPricingMatrix(value), value).toThrow(CityPricingUnavailableError);
    }
  });
});

describe("city prices", () => {
  it("matches a shop's city regardless of case and extra spaces", () => {
    expect(cityKey("  Dera   Ghazi Khan ")).toBe("dera ghazi khan");
    expect(cityPricingFor(matrix(), " lahore ")).toEqual({ name: "Lahore", adjustmentPercent: 10 });
  });

  it("charges the Shopify price for unlisted cities, 0% cities and when default prices are on", () => {
    expect(cityPricingFor(matrix(), "Okara")).toBeNull();
    expect(cityPricingFor(matrix(), "Multan")).toBeNull();
    expect(cityPricingFor(matrix(), "")).toBeNull();
    expect(cityPricingFor(null, "Lahore")).toBeNull();
    expect(cityPricingFor(matrix({ useDefaultPrices: true }), "Lahore")).toBeNull();
  });

  it("adds the city % to the Shopify price, rounded to the nearest rupee", () => {
    expect(cityUnitPrice(12000, { name: "Lahore", adjustmentPercent: 10 })).toBe(13200);
    expect(cityUnitPrice(9999, { name: "Lahore", adjustmentPercent: 5 })).toBe(10499);
    expect(cityUnitPrice(9500, { name: "Karachi", adjustmentPercent: -3 })).toBe(9215);
    expect(cityUnitPrice(12000, null)).toBe(12000);
  });

  it("updates carton and piece prices on the product list", () => {
    const products = [
      { variantId: "a", cartonPrice: 12000, piecesPerCarton: 100, pricePerPiece: 120 },
      { variantId: "b", cartonPrice: 15000, piecesPerCarton: null, pricePerPiece: null },
      { variantId: "c", cartonPrice: null, piecesPerCarton: 10, pricePerPiece: null },
    ] as ShopifyStoreProduct[];

    expect(applyCityPricing(products, { name: "Lahore", adjustmentPercent: 10 })
      .map((product) => [product.cartonPrice, product.pricePerPiece]))
      .toEqual([[13200, 132], [16500, null], [null, null]]);
    expect(applyCityPricing(products, null)).toBe(products);
  });

  it("lists the matrix cities by province for the city picker", () => {
    expect(cityChoices(matrix())).toEqual([
      { province: "Punjab", cities: ["Lahore", "Faisalabad", "Multan"] },
      { province: "Sindh", cities: ["Karachi"] },
    ]);
    expect(cityChoices(null)).toEqual([]);
  });
});

describe("city spelling and the staff summary", () => {
  beforeEach(() => {
    mocks.getShopifyCityPricingMatrix.mockReset().mockResolvedValue(matrix());
  });

  it("returns the matrix spelling of a listed city", async () => {
    await expect(findListedCityName("karachi ")).resolves.toBe("Karachi");
    await expect(findListedCityName("Okara")).resolves.toBeNull();
    mocks.getShopifyCityPricingMatrix.mockImplementation(shopifyDown);
    await expect(findListedCityName("karachi")).resolves.toBeNull();
  });

  it("tells staff what a shop pays", async () => {
    await expect(describeCityPrices("lahore")).resolves.toBe("Lahore: Shopify prices +10% (City-wise Pricing Matrix)");
    await expect(describeCityPrices("Karachi")).resolves.toBe("Karachi: Shopify prices -3% (City-wise Pricing Matrix)");
    await expect(describeCityPrices("Okara")).resolves.toBe("Shopify prices (this city isn't in the City-wise Pricing Matrix)");
    mocks.getShopifyCityPricingMatrix.mockResolvedValue(matrix({ useDefaultPrices: true }));
    await expect(describeCityPrices("Lahore")).resolves.toContain("Use default prices");
    mocks.getShopifyCityPricingMatrix.mockImplementation(shopifyDown);
    await expect(describeCityPrices("Lahore")).resolves.toBe("Couldn't load city prices from Shopify right now");
  });
});

describe("changing city on the shop details form", () => {
  const customerId = new ObjectId();

  function databaseFor(customer: { status: string; city?: string } | null) {
    const collection = () => ({
      findOne: async () => customer ? { shop_details: { status: customer.status, city: customer.city } } : null,
    });
    return { collection } as unknown as Db;
  }

  beforeEach(() => {
    mocks.getShopifyCityPricingMatrix.mockReset().mockResolvedValue(matrix());
  });

  it("saves a listed city under the matrix spelling", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "pending" }), customerId, "karachi"))
      .resolves.toEqual({ city: "Karachi" });
  });

  it("lets shops awaiting approval pick any city", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "pending", city: "Lahore" }), customerId, "Okara"))
      .resolves.toEqual({ city: "Okara" });
  });

  it("stops approved shops moving to a city with a different %", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "Lahore" }), customerId, "Multan"))
      .resolves.toEqual({ error: CITY_LOCKED_MESSAGE });
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "Okara" }), customerId, "Lahore"))
      .resolves.toEqual({ error: CITY_LOCKED_MESSAGE });
  });

  it("lets approved shops move between cities with the same % or fix spelling", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "Lahore" }), customerId, "faisalabad"))
      .resolves.toEqual({ city: "Faisalabad" });
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "Multan" }), customerId, "Okara"))
      .resolves.toEqual({ city: "Okara" });
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "lahore " }), customerId, "Lahore"))
      .resolves.toEqual({ city: "Lahore" });
  });

  it("doesn't let an approved shop change city while Shopify can't be checked", async () => {
    mocks.getShopifyCityPricingMatrix.mockImplementation(shopifyDown);
    const approved = databaseFor({ status: "approved", city: "Lahore" });
    await expect(resolveDetailsCity(approved, customerId, "Lahore")).resolves.toEqual({ city: "Lahore" });
    await expect(resolveDetailsCity(approved, customerId, "Multan")).resolves.toEqual({
      error: expect.stringContaining("couldn't check city prices"),
    });
    await expect(resolveDetailsCity(databaseFor({ status: "pending" }), customerId, "Multan"))
      .resolves.toEqual({ city: "Multan" });
  });
});
