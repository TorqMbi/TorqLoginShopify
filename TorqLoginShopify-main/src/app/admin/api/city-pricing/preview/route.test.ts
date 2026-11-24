import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  getActiveShopifyCatalog: vi.fn(),
}));

vi.mock("@/lib/staff-auth", () => ({ getStaffSession: mocks.getStaffSession }));
vi.mock("@/lib/shopify", () => ({ getActiveShopifyCatalog: mocks.getActiveShopifyCatalog }));

import { GET } from "./route";
import { CityPricingUnavailableError, parseCityPricingMatrix } from "@/lib/city-pricing-rules";

const admin = { id: "0123456789abcdef01234567", username: "owner", role: "admin" };
const products = [
  { variantId: "gid://shopify/ProductVariant/1", title: "6204-2RS", sku: "6204-2RS", cartonPrice: 10000, piecesPerCarton: 100, pricePerPiece: 100 },
  { variantId: "gid://shopify/ProductVariant/2", title: "6205-ZZ", sku: "6205-ZZ", cartonPrice: 15000, piecesPerCarton: null, pricePerPiece: null },
];

function matrixWith(useDefaultPrices = false) {
  return parseCityPricingMatrix(JSON.stringify({
    useDefaultPrices,
    baseCity: "Lahore",
    groups: [],
    cities: [
      { name: "Rawalpindi", province: "Punjab", group: "", adjustment: 10 },
      { name: "Multan", province: "Punjab", group: "", adjustment: 0 },
    ],
  }));
}

function preview(city: string) {
  return GET(new Request(`https://torq.example/admin/api/city-pricing/preview?city=${encodeURIComponent(city)}`));
}

describe("admin city price preview", () => {
  beforeEach(() => {
    mocks.getStaffSession.mockReset().mockResolvedValue(admin);
    mocks.getActiveShopifyCatalog.mockReset().mockResolvedValue({ products, cityPricing: matrixWith() });
  });

  it("is for administrators only", async () => {
    mocks.getStaffSession.mockResolvedValue({ ...admin, role: "staff" });
    expect((await preview("Rawalpindi")).status).toBe(403);
    mocks.getStaffSession.mockResolvedValue(null);
    expect((await preview("Rawalpindi")).status).toBe(401);
    expect(mocks.getActiveShopifyCatalog).not.toHaveBeenCalled();
  });

  it("shows each product's Shopify price and the city price (Rawalpindi +10%)", async () => {
    const response = await preview("rawalpindi");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.city).toEqual({ name: "Rawalpindi", adjustmentPercent: 10, applied: true });
    expect(body.products).toEqual([
      { variantId: "gid://shopify/ProductVariant/1", title: "6204-2RS", sku: "6204-2RS", shopifyPrice: 10000, cityPrice: 11000 },
      { variantId: "gid://shopify/ProductVariant/2", title: "6205-ZZ", sku: "6205-ZZ", shopifyPrice: 15000, cityPrice: 16500 },
    ]);
    expect(body.cities.map((city: { name: string }) => city.name)).toEqual(["Rawalpindi", "Multan"]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("shows Shopify prices for a 0% city and while default prices are on", async () => {
    const multan = await (await preview("Multan")).json();
    expect(multan.products.map((product: { cityPrice: number }) => product.cityPrice)).toEqual([10000, 15000]);

    mocks.getActiveShopifyCatalog.mockResolvedValue({ products, cityPricing: matrixWith(true) });
    const defaults = await (await preview("Rawalpindi")).json();
    expect(defaults.city).toEqual({ name: "Rawalpindi", adjustmentPercent: 10, applied: false });
    expect(defaults.products.map((product: { cityPrice: number }) => product.cityPrice)).toEqual([10000, 15000]);
  });

  it("explains an unreadable matrix or a Shopify outage", async () => {
    mocks.getActiveShopifyCatalog.mockRejectedValueOnce(new CityPricingUnavailableError("not valid JSON"));
    expect((await preview("Rawalpindi")).status).toBe(503);
    mocks.getActiveShopifyCatalog.mockRejectedValueOnce(new Error("network"));
    expect((await preview("Rawalpindi")).status).toBe(502);
  });
});
