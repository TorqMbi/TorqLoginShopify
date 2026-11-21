import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  insertOne: vi.fn(),
  getDatabase: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));
vi.mock("@/lib/db", () => ({
  getDatabase: mocks.getDatabase,
  isDatabaseConfigured: () => true,
}));
vi.mock("@/lib/auth", () => ({ createSession: mocks.createSession }));
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
    mocks.getDatabase.mockReset().mockResolvedValue({
      collection: () => ({ insertOne: mocks.insertOne }),
    });
  });

  it("creates a session and sends a new customer to shop details", async () => {
    const response = await POST(new Request("https://torq.example/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://torq.example" },
      body: JSON.stringify({
        mobileNumber: "+923001234567",
        username: "torqshop",
        password: "A-secure-password-123",
        confirmPassword: "A-secure-password-123",
      }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ redirectTo: "/account/details" });
    expect(mocks.createSession).toHaveBeenCalledWith("customer", "new-customer-id");
  });
});
