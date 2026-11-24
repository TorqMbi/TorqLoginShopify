import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  insertOne: vi.fn(),
  getDatabase: vi.fn(),
  createSession: vi.fn(),
  findListedCityName: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));
vi.mock("@/lib/db", () => ({
  getDatabase: mocks.getDatabase,
  isDatabaseConfigured: () => true,
}));
vi.mock("@/lib/auth", () => ({ createSession: mocks.createSession }));
vi.mock("@/lib/city-pricing", () => ({ findListedCityName: mocks.findListedCityName }));
vi.mock("@/lib/http", () => ({
  isSameOrigin: () => true,
  badOrigin: () => new Response(null, { status: 403 }),
  readJson: (request: Request) => request.json(),
}));

import { POST } from "./route";

describe("customer signup", () => {
  beforeEach(() => {
    mocks.hash.mockReset().mockResolvedValue("hashed-password");
    mocks.insertOne.mockReset().mockResolvedValue({ insertedId: { toString: () => "new-customer-id" } });
    mocks.createSession.mockReset().mockResolvedValue(undefined);
    mocks.findListedCityName.mockReset().mockResolvedValue(null);
    mocks.getDatabase.mockReset().mockResolvedValue({
      collection: () => ({ insertOne: mocks.insertOne }),
    });
  });

  const signupBody = {
    mobileNumber: "+923001234567",
    username: "torqshop",
    password: "A-secure-password-123",
    confirmPassword: "A-secure-password-123",
    terms: "on",
    contactPersonName: "Contact Person",
    shopName: "Torq Shop",
    contactMobileNumber: "+923001234568",
    alternateMobileNumber: "",
    shopAddress: "Main Road",
    detailedAddress: "Market",
    city: "Lahore",
    province: "Punjab",
    comments: "",
  };

  it("creates a complete pending account and redirects to its dashboard", async () => {
    const response = await POST(new Request("https://torq.example/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://torq.example" },
      body: JSON.stringify(signupBody),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ redirectTo: "/dashboard" });
    expect(mocks.createSession).toHaveBeenCalledWith("customer", "new-customer-id");
    const customer = mocks.insertOne.mock.calls[0][0];
    expect(customer.shop_details).toMatchObject({
      contactPersonName: "Contact Person",
      shopName: "Torq Shop",
      contactMobileNumber: "+923001234568",
      city: "Lahore",
      province: "Punjab",
      status: "pending",
      syncVersion: 0,
    });
    expect(customer.shop_details.completedAt).toBeInstanceOf(Date);
  });

  it("rejects signup when required shop details are missing", async () => {
    const { contactPersonName: _contactPersonName, ...incompleteBody } = signupBody;
    const response = await POST(new Request("https://torq.example/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://torq.example" },
      body: JSON.stringify(incompleteBody),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Contact person name is required and must be 2,000 characters or fewer.",
    });
    expect(mocks.insertOne).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("stores a city from the City-wise Pricing Matrix under its listed spelling", async () => {
    mocks.findListedCityName.mockResolvedValue("Karachi");
    const response = await POST(new Request("https://torq.example/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://torq.example" },
      body: JSON.stringify({ ...signupBody, city: "karachi" }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.findListedCityName).toHaveBeenCalledWith("karachi");
    expect(mocks.insertOne.mock.calls[0][0].shop_details.city).toBe("Karachi");
  });
});
