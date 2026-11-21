import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDatabase: vi.fn() }));

import {
  CITY_LOCKED_MESSAGE,
  applyCityPricing,
  cityKey,
  cityUnitPrice,
  cleanCityName,
  parseAdjustmentPercent,
  parsePriceOverrides,
  resolveDetailsCity,
  toCityPricing,
} from "./city-pricing";
import type { ShopifyStoreProduct } from "./shopify";

const VARIANT_A = "gid://shopify/ProductVariant/1";
const VARIANT_B = "gid://shopify/ProductVariant/2";

describe("city names and admin input", () => {
  it("matches cities regardless of case and extra spaces", () => {
    expect(cityKey("  Dera   Ghazi Khan ")).toBe("dera ghazi khan");
    expect(cityKey(undefined)).toBe("");
  });

  it("accepts real city names and rejects anything else", () => {
    expect(cleanCityName("  Karachi ")).toBe("Karachi");
    expect(cleanCityName("D.I. Khan")).toBe("D.I. Khan");
    expect(cleanCityName("Mandi Bahauddin")).toBe("Mandi Bahauddin");
    expect(cleanCityName("K")).toBeNull();
    expect(cleanCityName("<script>")).toBeNull();
    expect(cleanCityName("1 Lahore")).toBeNull();
    expect(cleanCityName("A".repeat(31))).toBeNull();
  });

  it("allows adjustments from -50% to +100%", () => {
    expect(parseAdjustmentPercent(5)).toBe(5);
    expect(parseAdjustmentPercent(-3.256)).toBe(-3.26);
    expect(parseAdjustmentPercent(-51)).toBeNull();
    expect(parseAdjustmentPercent(101)).toBeNull();
    expect(parseAdjustmentPercent("5")).toBeNull();
    expect(parseAdjustmentPercent(Number.NaN)).toBeNull();
  });

  it("accepts only positive exact prices for real product variants, once each", () => {
    expect(parsePriceOverrides([{ variantId: VARIANT_A, price: 14800 }])).toEqual([
      { variantId: VARIANT_A, price: 14800 },
    ]);
    expect(parsePriceOverrides([])).toEqual([]);
    expect(parsePriceOverrides([{ variantId: VARIANT_A, price: 0 }])).toBeNull();
    expect(parsePriceOverrides([{ variantId: "not-a-variant", price: 10 }])).toBeNull();
    expect(parsePriceOverrides([
      { variantId: VARIANT_A, price: 10 },
      { variantId: VARIANT_A, price: 11 },
    ])).toBeNull();
    expect(parsePriceOverrides("nope")).toBeNull();
  });
});

describe("city prices", () => {
  const karachi = toCityPricing({
    name: "Karachi",
    adjustmentPercent: 5,
    overrides: [{ variantId: VARIANT_B, price: 14800 }],
  });

  it("keeps the Shopify price when the city has no price list", () => {
    expect(cityUnitPrice(12000, VARIANT_A, null)).toBe(12000);
  });

  it("applies the city adjustment, rounded to the nearest rupee", () => {
    expect(cityUnitPrice(12000, VARIANT_A, karachi)).toBe(12600);
    expect(cityUnitPrice(9999, VARIANT_A, karachi)).toBe(10499);
    const discount = toCityPricing({ name: "Multan", adjustmentPercent: -3, overrides: [] });
    expect(cityUnitPrice(9500, VARIANT_A, discount)).toBe(9215);
  });

  it("uses an exact product price ahead of the adjustment", () => {
    expect(cityUnitPrice(15000, VARIANT_B, karachi)).toBe(14800);
  });

  it("updates carton and piece prices on the product list", () => {
    const products = [
      { variantId: VARIANT_A, cartonPrice: 12000, piecesPerCarton: 100, pricePerPiece: 120 },
      { variantId: VARIANT_B, cartonPrice: 15000, piecesPerCarton: null, pricePerPiece: null },
      { variantId: "gid://shopify/ProductVariant/3", cartonPrice: null, piecesPerCarton: 10, pricePerPiece: null },
    ] as ShopifyStoreProduct[];

    expect(applyCityPricing(products, karachi).map((product) => [product.cartonPrice, product.pricePerPiece]))
      .toEqual([[12600, 126], [14800, null], [null, null]]);
    expect(applyCityPricing(products, null)).toBe(products);
  });
});

describe("changing city on the shop details form", () => {
  const karachiId = new ObjectId();
  const lahoreId = new ObjectId();
  const priceLists = [
    { _id: karachiId, name: "Karachi", nameKey: "karachi" },
    { _id: lahoreId, name: "Lahore", nameKey: "lahore" },
  ];

  function databaseFor(customer: { status: string; city?: string } | null) {
    const collection = (name: string) => ({
      findOne: async (filter: { nameKey?: string }) => {
        if (name === "customers") {
          return customer ? { shop_details: { status: customer.status, city: customer.city } } : null;
        }
        return priceLists.find((list) => list.nameKey === filter.nameKey) ?? null;
      },
    });
    return { collection } as unknown as Db;
  }

  const customerId = new ObjectId();

  it("saves a priced city under its listed spelling", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "pending" }), customerId, "karachi"))
      .resolves.toEqual({ city: "Karachi" });
  });

  it("lets shops awaiting approval pick any city", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "pending", city: "Karachi" }), customerId, "Lahore"))
      .resolves.toEqual({ city: "Lahore" });
    await expect(resolveDetailsCity(databaseFor({ status: "blocked", city: "Karachi" }), customerId, "Okara"))
      .resolves.toEqual({ city: "Okara" });
  });

  it("stops approved shops moving to a different price list", async () => {
    const approvedInKarachi = databaseFor({ status: "approved", city: "Karachi" });
    await expect(resolveDetailsCity(approvedInKarachi, customerId, "Lahore"))
      .resolves.toEqual({ error: CITY_LOCKED_MESSAGE });
    await expect(resolveDetailsCity(approvedInKarachi, customerId, "Okara"))
      .resolves.toEqual({ error: CITY_LOCKED_MESSAGE });
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "Okara" }), customerId, "Lahore"))
      .resolves.toEqual({ error: CITY_LOCKED_MESSAGE });
  });

  it("lets approved shops fix spelling when their prices stay the same", async () => {
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "karachi " }), customerId, "Karachi"))
      .resolves.toEqual({ city: "Karachi" });
    await expect(resolveDetailsCity(databaseFor({ status: "approved", city: "Okara" }), customerId, "Sahiwal"))
      .resolves.toEqual({ city: "Sahiwal" });
  });
});
