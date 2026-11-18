import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  createShopifyCustomerQuery: vi.fn(),
  hasShopifyMetaobjectWriteScope: vi.fn(),
  getDatabase: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: mocks.getDatabase,
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));
vi.mock("@/lib/shopify", () => ({
  createShopifyCustomerQuery: mocks.createShopifyCustomerQuery,
  hasShopifyMetaobjectWriteScope: mocks.hasShopifyMetaobjectWriteScope,
}));

import { POST } from "./route";

const submissionKeys = {
  deleteOne: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  insertOne: vi.fn(),
  updateOne: vi.fn(),
};
const rateLimits = { findOneAndUpdate: vi.fn() };
const submissionId = "9a7ba6f6-8a3c-4c0d-9f7d-2bd11f2a9fa1";
const payloadHash = createHash("sha256")
  .update(JSON.stringify(["Jane Doe", "+923001234567", "I would like to ask about your products."]))
  .digest("hex");

afterEach(() => {
  vi.restoreAllMocks();
});

function request(body: Record<string, unknown>) {
  return new Request("https://torq.example/api/contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://torq.example",
      "x-nf-client-connection-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.27, 203.0.113.15",
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    submissionId,
    name: "Jane Doe",
    phone: "+92 300 1234567",
    message: "I would like to ask about your products.",
    ...overrides,
  };
}

describe("contact inquiry endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDatabaseConfigured.mockReturnValue(true);
    mocks.hasShopifyMetaobjectWriteScope.mockResolvedValue(true);
    mocks.createShopifyCustomerQuery.mockResolvedValue("gid://shopify/Metaobject/1");
    mocks.getDatabase.mockResolvedValue({
      collection: mocks.collection.mockImplementation((name: string) =>
        name === "contact_submission_keys" ? submissionKeys : rateLimits,
      ),
    });
    submissionKeys.insertOne.mockResolvedValue(undefined);
    submissionKeys.updateOne.mockResolvedValue({ matchedCount: 1 });
    submissionKeys.deleteOne.mockResolvedValue({ deletedCount: 1 });
    rateLimits.findOneAndUpdate.mockResolvedValue({
      count: 1,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
  });

  it("creates an inquiry only after validation and confirms Shopify saved it", async () => {
    const response = await POST(request(validBody()));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      message: "We've received your inquiry. Our team will contact you at the number you provided.",
    });
    expect(mocks.createShopifyCustomerQuery).toHaveBeenCalledWith({
      name: "Jane Doe",
      phone: "+923001234567",
      message: "I would like to ask about your products.",
      submissionId,
      submittedAt: expect.any(Date),
    });
    expect(rateLimits.findOneAndUpdate.mock.calls[0][0]._id).toMatch(
      new RegExp(`^${createHash("sha256").update("203.0.113.15").digest("hex")}:`),
    );
    expect(submissionKeys.updateOne).toHaveBeenCalledWith(
      { _id: submissionId, state: "processing", leaseId: expect.any(String) },
      expect.objectContaining({ $set: expect.objectContaining({ state: "saved" }) }),
    );
  });

  it("rejects invalid numbers and honeypot submissions without contacting Shopify", async () => {
    const invalidPhone = await POST(request(validBody({ phone: "not a phone" })));
    const honeypot = await POST(request(validBody({ website: "spam" })));

    expect(invalidPhone.status).toBe(400);
    expect(honeypot.status).toBe(400);
    expect(mocks.createShopifyCustomerQuery).not.toHaveBeenCalled();
    expect(submissionKeys.insertOne).not.toHaveBeenCalled();
  });

  it("does not create another metaobject for a repeated saved submission key", async () => {
    submissionKeys.insertOne.mockRejectedValueOnce({ code: 11000 });
    submissionKeys.findOne.mockResolvedValueOnce({ state: "saved", payloadHash });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(200);
    expect(mocks.createShopifyCustomerQuery).not.toHaveBeenCalled();
    expect(rateLimits.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a reused submission key with different inquiry content", async () => {
    submissionKeys.insertOne.mockRejectedValueOnce({ code: 11000 });
    submissionKeys.findOne.mockResolvedValueOnce({ state: "saved", payloadHash });

    const response = await POST(request(validBody({ message: "A different question." })));

    expect(response.status).toBe(409);
    expect(mocks.createShopifyCustomerQuery).not.toHaveBeenCalled();
  });

  it("enforces the rate limit before calling Shopify", async () => {
    rateLimits.findOneAndUpdate.mockResolvedValueOnce({ count: 6 });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(mocks.createShopifyCustomerQuery).not.toHaveBeenCalled();
    expect(submissionKeys.deleteOne).toHaveBeenCalledWith({
      _id: submissionId,
      leaseId: expect.any(String),
    });
  });

  it("returns a retryable error when Shopify fails", async () => {
    mocks.createShopifyCustomerQuery.mockRejectedValueOnce(new Error("Shopify unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(validBody()));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "We couldn't save your message. Please try again.",
    });
    expect(submissionKeys.updateOne).toHaveBeenCalledWith(
      { _id: submissionId, state: "processing", leaseId: expect.any(String) },
      { $set: { leaseUntil: new Date(0) } },
    );
  });

  it("preserves the server submission time when a claimed inquiry is retried", async () => {
    const submittedAt = new Date("2026-11-18T09:00:00.000Z");
    submissionKeys.insertOne.mockRejectedValueOnce({ code: 11000 });
    submissionKeys.findOne.mockResolvedValueOnce({
      state: "processing",
      payloadHash,
      submittedAt,
    });
    submissionKeys.findOneAndUpdate.mockResolvedValueOnce({ submittedAt });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(201);
    expect(mocks.createShopifyCustomerQuery).toHaveBeenCalledWith(
      expect.objectContaining({ submittedAt }),
    );
  });

  it("does not submit an inquiry when the installed app lacks write_metaobjects", async () => {
    mocks.hasShopifyMetaobjectWriteScope.mockResolvedValueOnce(false);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(validBody()));

    expect(response.status).toBe(502);
    expect(mocks.createShopifyCustomerQuery).not.toHaveBeenCalled();
  });
});
