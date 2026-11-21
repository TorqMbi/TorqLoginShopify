import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoreAccess: vi.fn(),
  getActiveShopifyProducts: vi.fn(),
  getCustomerCityPricing: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/store-access", () => ({ getStoreAccess: mocks.getStoreAccess }));
vi.mock("@/lib/shopify", () => ({
  getActiveShopifyProducts: mocks.getActiveShopifyProducts,
}));
vi.mock("@/lib/city-pricing", async () => {
  const rules = await vi.importActual<typeof import("@/lib/city-pricing-rules")>("@/lib/city-pricing-rules");
  return { ...rules, getCustomerCityPricing: mocks.getCustomerCityPricing };
});

import { GET } from "./route";

describe("approved Shopify product API", () => {
  beforeEach(() => {
    mocks.getStoreAccess.mockReset();
    mocks.getActiveShopifyProducts.mockReset().mockResolvedValue([{ title: "6300-2RS" }]);
    mocks.getCustomerCityPricing.mockReset().mockResolvedValue(null);
  });

  it("shows the customer's city prices", async () => {
    mocks.getStoreAccess.mockResolvedValue({ kind: "approved", customerId: "customer-1" });
    mocks.getActiveShopifyProducts.mockResolvedValue([
      { variantId: "gid://shopify/ProductVariant/1", title: "6300-2RS", cartonPrice: 12000, piecesPerCarton: 100, pricePerPiece: 120 },
      { variantId: "gid://shopify/ProductVariant/2", title: "6301-2RS", cartonPrice: 9500, piecesPerCarton: null, pricePerPiece: null },
    ]);
    mocks.getCustomerCityPricing.mockResolvedValue({
      name: "Karachi",
      adjustmentPercent: 5,
      overrides: new Map([["gid://shopify/ProductVariant/2", 9000]]),
    });
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getCustomerCityPricing).toHaveBeenCalledWith("customer-1");
    const { products } = await response.json();
    expect(products.map((product: { cartonPrice: number; pricePerPiece: number | null }) =>
      [product.cartonPrice, product.pricePerPiece])).toEqual([[12600, 126], [9000, null]]);
  });

  it("returns active products for approved customers", async () => {
    mocks.getStoreAccess.mockResolvedValue({ kind: "approved" });
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      products: [{ title: "6300-2RS" }],
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getActiveShopifyProducts).toHaveBeenCalledOnce();
  });

  it.each([
    ["logged-out", "unauthenticated", 401],
    ["pending", "pending", 403],
    ["blocked", "blocked", 403],
    ["details-incomplete", "incomplete", 403],
  ])("denies %s customers before Shopify access", async (_label, kind, expectedStatus) => {
    mocks.getStoreAccess.mockResolvedValue({ kind });
    const response = await GET();

    expect(response.status).toBe(expectedStatus);
    expect(mocks.getActiveShopifyProducts).not.toHaveBeenCalled();
  });
});
