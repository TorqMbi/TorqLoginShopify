import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session = {
    withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
    endSession: vi.fn(),
  };
  const updateOne = vi.fn();
  const findOne = vi.fn();
  const collection = vi.fn();
  const getDatabase = vi.fn();
  const enqueueShopifySync = vi.fn();
  const syncCustomerShopifyNow = vi.fn();
  const resolveDetailsCity = vi.fn();
  return {
    resolveDetailsCity,
    session,
    updateOne,
    findOne,
    collection,
    getDatabase,
    enqueueShopifySync,
    syncCustomerShopifyNow,
  };
});

vi.mock("@/lib/auth", () => ({
  getSession: async () => ({ role: "customer", customerId: "abcdef0123456789abcdef01" }),
}));
vi.mock("@/lib/db", () => ({
  getDatabase: mocks.getDatabase,
  isDatabaseConfigured: () => true,
}));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, isSameOrigin: () => true };
});
vi.mock("@/lib/shopify-outbox", () => ({
  CUSTOMER_SHOPIFY_SYNC_TIMEOUT_MS: 20000,
  enqueueShopifySync: mocks.enqueueShopifySync,
  syncCustomerShopifyNow: mocks.syncCustomerShopifyNow,
}));

vi.mock("@/lib/city-pricing", () => ({ resolveDetailsCity: mocks.resolveDetailsCity }));

import { PATCH } from "./route";

function detailsRequest(city: string) {
  return new Request("https://torq.example/api/account/details", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://torq.example" },
    body: JSON.stringify({
      contactPersonName: "Contact Person",
      shopName: "Torq Shop",
      contactMobileNumber: "+923001234567",
      shopAddress: "Main Road",
      detailedAddress: "Market",
      city,
      province: "Sindh",
    }),
  });
}

describe("customer shop details updates", () => {
  beforeEach(() => {
    mocks.session.withTransaction.mockClear();
    mocks.session.endSession.mockClear();
    mocks.updateOne.mockReset().mockResolvedValue({ matchedCount: 1 });
    mocks.findOne.mockReset().mockResolvedValue({ shop_details: { syncVersion: 1 } });
    mocks.enqueueShopifySync.mockReset().mockResolvedValue(undefined);
    mocks.syncCustomerShopifyNow.mockReset().mockResolvedValue({
      state: "pending",
      lastError: "",
    });
    mocks.resolveDetailsCity.mockReset().mockImplementation(async (_database, _customerId, city: string) => ({ city }));
    mocks.collection.mockImplementation(() => ({ updateOne: mocks.updateOne, findOne: mocks.findOne }));
    mocks.getDatabase.mockResolvedValue({
      client: { startSession: () => mocks.session },
      collection: mocks.collection,
    });
  });

  it("ignores customer-supplied status and only updates shop details", async () => {
    const response = await PATCH(
      new Request("https://torq.example/api/account/details", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "https://torq.example" },
        body: JSON.stringify({
          contactPersonName: "Contact Person",
          shopName: "Torq Shop",
          contactMobileNumber: "+923001234567",
          alternateMobileNumber: "",
          shopAddress: "Main Road",
          detailedAddress: "Market",
          city: "Lahore",
          province: "Punjab",
          comments: "",
          status: "approved",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      shopifySync: { state: "pending" },
    });
    const pipeline = mocks.updateOne.mock.calls[0][1] as Array<{ $set: Record<string, unknown> }>;
    expect(pipeline[0].$set).not.toHaveProperty("shop_details.status");
    expect(mocks.enqueueShopifySync).toHaveBeenCalledOnce();
    expect(mocks.syncCustomerShopifyNow).toHaveBeenCalledOnce();
  });

  it("saves a priced city under its price-list spelling", async () => {
    mocks.resolveDetailsCity.mockResolvedValue({ city: "Karachi" });
    const response = await PATCH(detailsRequest("  karachi "));

    expect(response.status).toBe(200);
    expect(mocks.resolveDetailsCity.mock.calls[0][2]).toBe("karachi");
    const pipeline = mocks.updateOne.mock.calls[0][1] as Array<{ $set: Record<string, unknown> }>;
    expect(pipeline[0].$set["shop_details.city"]).toBe("Karachi");
  });

  it("refuses a city change that would move an approved shop to another price list", async () => {
    mocks.resolveDetailsCity.mockResolvedValue({ error: "Your prices depend on your city." });
    const response = await PATCH(detailsRequest("Multan"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Your prices depend on your city." });
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.enqueueShopifySync).not.toHaveBeenCalled();
  });
});
