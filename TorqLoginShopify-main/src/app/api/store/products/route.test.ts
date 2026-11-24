import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoreAccess: vi.fn(),
  getActiveShopifyCatalog: vi.fn(),
  getCustomerCity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/store-access", () => ({ getStoreAccess: mocks.getStoreAccess }));
vi.mock("@/lib/shopify", () => ({
  getActiveShopifyCatalog: mocks.getActiveShopifyCatalog,
}));
vi.mock("@/lib/city-pricing", async () => {
  const rules = await vi.importActual<typeof import("@/lib/city-pricing-rules")>("@/lib/city-pricing-rules");
  return { ...rules, getCustomerCity: mocks.getCustomerCity };
});

import { GET } from "./route";
import { CityPricingUnavailableError, parseCityPricingMatrix } from "@/lib/city-pricing-rules";

const matrix = parseCityPricingMatrix(JSON.stringify({
  useDefaultPrices: false,
  baseCity: "Lahore",
  groups: [],
  cities: [{ name: "Lahore", province: "Punjab", group: "", adjustment: 10 }],
}));

const products = [
  { variantId: "gid://shopify/ProductVariant/1", title: "6300-2RS", cartonPrice: 12000, piecesPerCarton: 100, pricePerPiece: 120 },
  { variantId: "gid://shopify/ProductVariant/2", title: "6301-2RS", cartonPrice: 9500, piecesPerCarton: null, pricePerPiece: null },
];

describe("approved Shopify product API", () => {
  beforeEach(() => {
    mocks.getStoreAccess.mockReset();
    mocks.getActiveShopifyCatalog.mockReset().mockResolvedValue({ products: [{ title: "6300-2RS" }], cityPricing: null });
    mocks.getCustomerCity.mockReset().mockResolvedValue("Okara");
  });

  it("adds the shop's city % from the City-wise Pricing Matrix", async () => {
    mocks.getStoreAccess.mockResolvedValue({ kind: "approved", customerId: "customer-1" });
    mocks.getActiveShopifyCatalog.mockResolvedValue({ products, cityPricing: matrix });
    mocks.getCustomerCity.mockResolvedValue("lahore");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getCustomerCity).toHaveBeenCalledWith("customer-1");
    const body = await response.json();
    expect(body.products.map((product: { cartonPrice: number; pricePerPiece: number | null }) =>
      [product.cartonPrice, product.pricePerPiece])).toEqual([[13200, 132], [10450, null]]);
  });

  it("shows Shopify prices to a shop whose city isn't in the matrix", async () => {
    mocks.getStoreAccess.mockResolvedValue({ kind: "approved", customerId: "customer-1" });
    mocks.getActiveShopifyCatalog.mockResolvedValue({ products, cityPricing: matrix });
    const body = await (await GET()).json();
    expect(body.products.map((product: { cartonPrice: number }) => product.cartonPrice)).toEqual([12000, 9500]);
  });

  it("shows no prices rather than wrong ones when the matrix is unreadable", async () => {
    mocks.getStoreAccess.mockResolvedValue({ kind: "approved", customerId: "customer-1" });
    mocks.getActiveShopifyCatalog.mockRejectedValue(new CityPricingUnavailableError("not valid JSON"));
    const response = await GET();
    expect(response.status).toBe(502);
  });

  it("returns active products for approved customers", async () => {
    mocks.getStoreAccess.mockResolvedValue({ kind: "approved" });
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      products: [{ title: "6300-2RS" }],
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getActiveShopifyCatalog).toHaveBeenCalledOnce();
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
    expect(mocks.getActiveShopifyCatalog).not.toHaveBeenCalled();
  });
});
