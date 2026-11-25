import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  collection: vi.fn(),
  customers: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    find: vi.fn(),
    deleteOne: vi.fn(),
  },
  jobs: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
    deleteMany: vi.fn(),
  },
  deleteMany: vi.fn(),
  reconciliationState: { findOne: vi.fn(), updateOne: vi.fn() },
  events: { insertOne: vi.fn(), deleteMany: vi.fn() },
  ensureShopifyCustomer: vi.fn(),
  findShopifyCustomerByPhone: vi.fn(),
  getShopifyCustomerName: vi.fn(),
  getShopifyCustomerTags: vi.fn(),
  writeShopifyMetafields: vi.fn(),
  writeShopifyStatusTags: vi.fn(),
  ShopifyCustomerNotFoundError: class ShopifyCustomerNotFoundError extends Error {
    constructor() {
      super("Linked Shopify customer was not found.");
    }
  },
}));

vi.mock("./db", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("./shopify", () => ({
  ensureShopifyCustomer: mocks.ensureShopifyCustomer,
  findShopifyCustomerByPhone: mocks.findShopifyCustomerByPhone,
  getShopifyCustomerName: mocks.getShopifyCustomerName,
  getShopifyCustomerTags: mocks.getShopifyCustomerTags,
  ShopifyCustomerNotFoundError: mocks.ShopifyCustomerNotFoundError,
  writeShopifyMetafields: mocks.writeShopifyMetafields,
  writeShopifyStatusTags: mocks.writeShopifyStatusTags,
}));

import { runShopifyWorker, syncCustomerShopifyNow } from "./shopify-outbox";

function cursor(items: unknown[]) {
  return {
    sort: () => cursor(items),
    limit: () => cursor(items),
    toArray: async () => items,
  };
}

describe("Shopify outbox worker", () => {
  const id = new ObjectId();
  const customer = {
    _id: id,
    username: "torq-customer",
    mobileNumber: "+923001234567",
    shopifyCustomerId: "gid://shopify/Customer/42",
    shop_details: {
      status: "approved" as const,
      syncVersion: 4,
      completedAt: new Date("2026-10-10T00:00:00.000Z"),
      contactPersonName: "Contact Person",
      contactMobileNumber: "+923001234567",
    },
  };

  beforeEach(() => {
    mocks.getDatabase.mockReset().mockResolvedValue({ collection: mocks.collection });
    mocks.collection.mockImplementation((name: string) => {
      if (name === "customers") return mocks.customers;
      if (name === "shopify_sync_jobs") return mocks.jobs;
      if (name === "status_events") return mocks.events;
      if (name === "shopify_reconciliation_state") return mocks.reconciliationState;
      return { deleteMany: mocks.deleteMany };
    });
    mocks.customers.findOne.mockReset().mockResolvedValue(customer);
    mocks.customers.updateOne.mockReset().mockResolvedValue({ matchedCount: 1 });
    mocks.customers.deleteOne.mockReset().mockResolvedValue({ deletedCount: 1 });
    mocks.customers.find.mockReset().mockReturnValue(cursor([]));
    mocks.jobs.findOneAndUpdate.mockReset();
    mocks.jobs.findOne.mockReset();
    mocks.jobs.updateOne.mockReset().mockResolvedValue({ matchedCount: 1 });
    mocks.jobs.deleteMany.mockReset().mockResolvedValue({ deletedCount: 1 });
    mocks.deleteMany.mockReset().mockResolvedValue({ deletedCount: 1 });
    mocks.events.insertOne.mockReset().mockResolvedValue({});
    mocks.events.deleteMany.mockReset().mockResolvedValue({ deletedCount: 1 });
    mocks.reconciliationState.findOne.mockReset().mockResolvedValue(null);
    mocks.reconciliationState.updateOne.mockReset().mockResolvedValue({ matchedCount: 1 });
    mocks.ensureShopifyCustomer.mockReset().mockResolvedValue(customer.shopifyCustomerId);
    mocks.findShopifyCustomerByPhone.mockReset().mockResolvedValue(customer.shopifyCustomerId);
    mocks.getShopifyCustomerName.mockReset().mockResolvedValue("Contact Person");
    mocks.getShopifyCustomerTags.mockReset().mockResolvedValue(["vip", "blocked"]);
    mocks.writeShopifyMetafields.mockReset().mockResolvedValue(undefined);
    mocks.writeShopifyStatusTags.mockReset().mockResolvedValue(undefined);
  });

  it("records Shopify failures and schedules exponential retry without changing portal status", async () => {
    const job = {
      _id: id,
      customerId: id,
      version: 4,
      status: "processing",
      attempts: 2,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.jobs.findOneAndUpdate.mockResolvedValueOnce(job).mockResolvedValue(null);
    mocks.writeShopifyMetafields.mockRejectedValueOnce(new Error("Shopify temporarily unavailable."));

    const result = await runShopifyWorker();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(["One or more Shopify sync jobs failed."]);
    expect(mocks.jobs.updateOne).toHaveBeenCalledOnce();
    const failureUpdate = mocks.jobs.updateOne.mock.calls[0][1] as {
      $set: { status: string; lastError: string; nextAttemptAt: Date };
    };
    expect(failureUpdate.$set.status).toBe("failed");
    expect(failureUpdate.$set.lastError).toContain("temporarily unavailable");
    expect(failureUpdate.$set.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 1000);
    expect(mocks.customers.updateOne).toHaveBeenCalledWith(
      { _id: id, "shop_details.syncVersion": 4 },
      {
        $set: expect.objectContaining({
          shopifyCustomerId: customer.shopifyCustomerId,
          shopifyCustomerName: "Contact Person",
        }),
      },
    );
  });

  it("repairs Shopify tag drift to the local status and records a system audit event", async () => {
    mocks.jobs.findOneAndUpdate.mockResolvedValue(null);
    mocks.customers.find.mockReturnValue(cursor([customer]));
    mocks.customers.findOne.mockResolvedValue(customer);

    const result = await runShopifyWorker();

    expect(result.reconciled).toBe(1);
    expect(mocks.writeShopifyStatusTags).toHaveBeenCalledWith(
      customer.shopifyCustomerId,
      "approved",
      ["vip", "blocked"],
    );
    expect(mocks.events.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      customerId: id,
      staffUserId: null,
      actorLabel: "system: reconciled",
      oldStatus: "approved",
      newStatus: "approved",
      eventType: "reconciled",
    }));
    expect(mocks.customers.updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $set: { shopifyCustomerName: "Contact Person" } },
    );
  });

  it("deletes an approved unlinked portal account when no Shopify customer matches its phone", async () => {
    const unlinkedCustomer = {
      ...customer,
      shopifyCustomerId: undefined,
    };
    mocks.jobs.findOneAndUpdate.mockResolvedValue(null);
    mocks.customers.find.mockReturnValue(cursor([unlinkedCustomer]));
    mocks.findShopifyCustomerByPhone.mockResolvedValueOnce(null);

    const result = await runShopifyWorker();

    expect(result.reconciled).toBe(1);
    expect(mocks.customers.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  it("deletes a portal account when its linked Shopify customer was deleted", async () => {
    mocks.jobs.findOneAndUpdate.mockResolvedValue(null);
    mocks.customers.find.mockReturnValue(cursor([customer]));
    mocks.getShopifyCustomerName.mockRejectedValueOnce(
      new mocks.ShopifyCustomerNotFoundError(),
    );

    const result = await runShopifyWorker();

    expect(result.reconciled).toBe(1);
    expect(mocks.customers.deleteOne).toHaveBeenCalledWith({ _id: id });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ customerId: id });
  });

  it("counts completed sync jobs as succeeded", async () => {
    const job = {
      _id: id,
      customerId: id,
      version: 4,
      status: "processing",
      attempts: 1,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.jobs.findOneAndUpdate.mockResolvedValueOnce(job).mockResolvedValue(null);
    mocks.getShopifyCustomerTags.mockResolvedValue(["approved"]);

    const result = await runShopifyWorker();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("processes only the requested customer's queued job and skips reconciliation", async () => {
    const job = {
      _id: id,
      customerId: id,
      version: 4,
      status: "processing",
      attempts: 1,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.jobs.findOneAndUpdate.mockResolvedValueOnce(job);
    mocks.getShopifyCustomerTags.mockResolvedValue(["approved"]);

    await expect(syncCustomerShopifyNow(id)).resolves.toEqual({
      state: "synced",
      lastError: "",
    });

    const claimFilter = mocks.jobs.findOneAndUpdate.mock.calls[0][0];
    expect(claimFilter._id).toBe(id);
    expect(mocks.customers.find).not.toHaveBeenCalled();
    const requestOptions = mocks.writeShopifyMetafields.mock.calls[0][2];
    expect(requestOptions.deadlineAt).toBeGreaterThan(Date.now());
    expect(requestOptions.deadlineAt).toBeLessThanOrEqual(Date.now() + 20_000);
  });

  it("deletes the portal account when an explicit link-repair finds a deleted Shopify customer", async () => {
    mocks.jobs.findOneAndUpdate.mockResolvedValueOnce({
      _id: id,
      customerId: id,
      version: 4,
      repairShopifyLink: true,
      status: "processing",
      attempts: 1,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.getShopifyCustomerTags.mockRejectedValueOnce(
      new mocks.ShopifyCustomerNotFoundError(),
    );

    await expect(syncCustomerShopifyNow(id)).resolves.toEqual({
      state: "synced",
      lastError: "",
    });

    expect(mocks.ensureShopifyCustomer).not.toHaveBeenCalled();
    expect(mocks.customers.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  it("returns Pending Sync when another worker owns the customer's job", async () => {
    mocks.jobs.findOneAndUpdate.mockResolvedValueOnce(null);
    mocks.jobs.findOne.mockResolvedValueOnce({
      _id: id,
      status: "processing",
      lastError: "",
    });

    await expect(syncCustomerShopifyNow(id)).resolves.toEqual({
      state: "pending",
      lastError: "",
    });
    expect(mocks.customers.findOne).not.toHaveBeenCalled();
  });

  it("reports failed targeted sync while retaining the job's retry backoff", async () => {
    const job = {
      _id: id,
      customerId: id,
      version: 4,
      status: "processing",
      attempts: 1,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.jobs.findOneAndUpdate.mockResolvedValueOnce(job);
    mocks.writeShopifyMetafields.mockRejectedValueOnce(
      new Error("Shopify Admin API returned HTTP 500."),
    );
    mocks.jobs.findOne.mockResolvedValueOnce({
      _id: id,
      status: "failed",
      lastError: "Shopify Admin API returned HTTP 500.",
    });

    await expect(syncCustomerShopifyNow(id)).resolves.toEqual({
      state: "failed",
      lastError: "Shopify Admin API returned HTTP 500.",
    });

    const failureUpdate = mocks.jobs.updateOne.mock.calls[0][1] as {
      $set: { status: string; nextAttemptAt: Date };
    };
    expect(failureUpdate.$set.status).toBe("failed");
    expect(failureUpdate.$set.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(customer.shop_details.status).toBe("approved");
  });
});
