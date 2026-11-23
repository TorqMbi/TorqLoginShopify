import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  insertOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  findOneAndDelete: vi.fn(),
  collection: vi.fn(),
}));

vi.mock("@/lib/staff-auth", () => ({ getStaffSession: mocks.getStaffSession }));
vi.mock("@/lib/db", () => ({
  getDatabase: async () => ({ collection: mocks.collection }),
  isDatabaseConfigured: () => true,
}));

import { POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const admin = { id: "0123456789abcdef01234567", username: "owner", role: "admin" };
const cityId = new ObjectId().toString();
const context = { params: Promise.resolve({ id: cityId }) };

function request(method: string, body?: unknown, origin = "https://torq.example") {
  return new Request(`https://torq.example/admin/api/city-pricing/${cityId}`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("admin city pricing API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStaffSession.mockResolvedValue(admin);
    mocks.insertOne.mockResolvedValue({ acknowledged: true });
    mocks.findOneAndUpdate.mockResolvedValue({ name: "Karachi" });
    mocks.findOneAndDelete.mockResolvedValue({ name: "Karachi" });
    mocks.collection.mockReturnValue({
      insertOne: mocks.insertOne,
      findOneAndUpdate: mocks.findOneAndUpdate,
      findOneAndDelete: mocks.findOneAndDelete,
    });
  });

  it("is limited to admin accounts", async () => {
    mocks.getStaffSession.mockResolvedValue({ ...admin, role: "staff" });
    expect((await POST(request("POST", { name: "Karachi" }))).status).toBe(403);
    mocks.getStaffSession.mockResolvedValue(null);
    expect((await PATCH(request("PATCH", { overrides: [] }), context)).status).toBe(401);
    expect(mocks.insertOne).not.toHaveBeenCalled();
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refuses requests from other websites", async () => {
    const response = await DELETE(request("DELETE", undefined, "https://evil.example"), context);
    expect(response.status).toBe(403);
    expect(mocks.findOneAndDelete).not.toHaveBeenCalled();
  });

  it("creates a city price list with a tidy name, matching key and no prices yet", async () => {
    const response = await POST(request("POST", { name: "  karachi ", adjustmentPercent: 5 }));

    expect(response.status).toBe(201);
    // A % sent by an old screen is ignored; 0 is stored for older app versions.
    expect(mocks.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      name: "karachi",
      nameKey: "karachi",
      adjustmentPercent: 0,
      overrides: [],
      updatedBy: "owner",
    }));
  });

  it("rejects bad city names and duplicate cities", async () => {
    expect((await POST(request("POST", { name: "<b>" }))).status).toBe(400);
    mocks.insertOne.mockRejectedValueOnce({ code: 11000 });
    const duplicate = await POST(request("POST", { name: "Karachi" }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ error: "Karachi already has a price list." });
  });

  it("saves the city's price table and sets any old % adjustment to 0", async () => {
    const overrides = [{ variantId: "gid://shopify/ProductVariant/2", price: 14800 }];
    const response = await PATCH(request("PATCH", { adjustmentPercent: -3, overrides }), context);

    expect(response.status).toBe(200);
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new ObjectId(cityId) },
      { $set: expect.objectContaining({ adjustmentPercent: 0, overrides, updatedBy: "owner" }) },
      expect.anything(),
    );
  });

  it("rejects exact prices that are zero, negative or for unknown products", async () => {
    for (const overrides of [
      [{ variantId: "gid://shopify/ProductVariant/2", price: 0 }],
      [{ variantId: "gid://shopify/ProductVariant/2", price: -10 }],
      [{ variantId: "gid://shopify/Product/2", price: 100 }],
      "not-a-list",
    ]) {
      const response = await PATCH(request("PATCH", { overrides }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports a missing price list", async () => {
    mocks.findOneAndUpdate.mockResolvedValue(null);
    mocks.findOneAndDelete.mockResolvedValue(null);
    expect((await PATCH(request("PATCH", { overrides: [] }), context)).status).toBe(404);
    expect((await DELETE(request("DELETE"), context)).status).toBe(404);
    const badId = { params: Promise.resolve({ id: "not-an-id" }) };
    expect((await DELETE(request("DELETE"), badId)).status).toBe(404);
  });

  it("deletes a price list so the city falls back to Shopify prices", async () => {
    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Karachi price list deleted. Shops in Karachi now see standard Shopify prices.",
    });
  });
});
