import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import {
  getDatabase,
  type CustomerDocument,
  type ShopifySyncJobDocument,
  type StatusEventDocument,
} from "./db";
import {
  ensureShopifyCustomer,
  findShopifyCustomerByPhone,
  getShopifyCustomerName,
  getShopifyCustomerTags,
  ShopifyCustomerNotFoundError,
  writeShopifyMetafields,
  writeShopifyStatusTags,
  type ShopifyRequestOptions,
} from "./shopify";
import { hasShopifyStatusTag } from "./verification";

const BACKOFF_BASE_MS = 15 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const JOB_LEASE_MS = 5 * 60 * 1000;
const SYNC_BATCH_SIZE = 8;
const RECONCILIATION_BATCH_SIZE = 10;
export const CUSTOMER_SHOPIFY_SYNC_TIMEOUT_MS = 20_000;

export type ShopifySyncState = "synced" | "pending" | "failed";
export type ShopifySyncAttemptResult = {
  state: ShopifySyncState;
  lastError: string;
};

export async function enqueueShopifySync(
  database: Db,
  customerId: ObjectId,
  version: number,
  options: {
    session?: import("mongodb").ClientSession;
    repairShopifyLink?: boolean;
  } = {},
): Promise<void> {
  const now = new Date();
  await database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").updateOne(
    { _id: customerId },
    {
      $set: {
        customerId,
        version,
        repairShopifyLink: options.repairShopifyLink ?? false,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        updatedAt: now,
        lastError: "",
      },
      $setOnInsert: { createdAt: now },
      $unset: { leaseUntil: "", syncedAt: "" },
    },
    { upsert: true, ...(options.session ? { session: options.session } : {}) },
  );
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unexpected Shopify sync failure.").slice(0, 1000);
}

async function claimNextJob(
  database: Db,
  customerId?: ObjectId,
): Promise<ShopifySyncJobDocument | null> {
  const now = new Date();
  return database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").findOneAndUpdate(
    {
      ...(customerId ? { _id: customerId } : {}),
      $or: [
        { status: { $in: ["pending", "failed"] }, nextAttemptAt: { $lte: now } },
        { status: "processing", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: "processing", leaseUntil: new Date(now.getTime() + JOB_LEASE_MS), updatedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
  );
}

async function runSyncJob(
  database: Db,
  job: ShopifySyncJobDocument,
  options: ShopifyRequestOptions = {},
): Promise<{ succeeded: boolean }> {
  const customers = database.collection<CustomerDocument>("customers");
  const customer = await customers.findOne({ _id: job.customerId });
  if (!customer) {
    await database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").updateOne(
      { _id: job._id, version: job.version },
      {
        $set: {
          status: "failed",
          lastError: "Customer record was not found.",
          nextAttemptAt: new Date(Date.now() + BACKOFF_BASE_MS),
          updatedAt: new Date(),
        },
        $unset: { leaseUntil: "" },
      },
    );
    return { succeeded: false };
  }

  const details = customer.shop_details;
  if (!details?.completedAt || !details.contactMobileNumber) {
    await database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").updateOne(
      { _id: job._id, version: job.version },
      {
        $set: {
          status: "pending",
          nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
          lastError: "",
          updatedAt: new Date(),
        },
        $unset: { leaseUntil: "" },
      },
    );
    return { succeeded: false };
  }

  try {
    let shopifyCustomerId = customer.shopifyCustomerId;
    let existingShopifyTags: string[] | undefined;
    if (shopifyCustomerId && job.repairShopifyLink) {
      try {
        existingShopifyTags = await getShopifyCustomerTags(shopifyCustomerId, options);
      } catch (error) {
        if (!(error instanceof ShopifyCustomerNotFoundError)) throw error;
        await deleteDeletedShopifyCustomer(database, customer._id);
        return { succeeded: true };
      }
    }
    shopifyCustomerId ??= await ensureShopifyCustomer(
      details.contactMobileNumber,
      details.contactPersonName || customer.username,
      options,
    );
    const shopifyCustomerName = await getShopifyCustomerName(shopifyCustomerId, options);

    const linked = await customers.updateOne(
      { _id: customer._id, "shop_details.syncVersion": job.version },
      {
        $set: {
          shopifyCustomerId,
          ...(shopifyCustomerName ? { shopifyCustomerName } : {}),
        },
      },
    );
    if (linked.matchedCount !== 1) return { succeeded: false };
    await writeShopifyMetafields(shopifyCustomerId, details, options);
    await writeShopifyStatusTags(shopifyCustomerId, details.status, existingShopifyTags, options);

    const latestCustomer = await customers.findOne(
      { _id: customer._id },
      { projection: { "shop_details.syncVersion": 1 } },
    );
    if (latestCustomer?.shop_details.syncVersion !== job.version) {
      return { succeeded: false };
    }

    const syncedJob = await database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").updateOne(
      { _id: job._id, version: job.version, status: "processing" },
      {
        $set: { status: "synced", syncedAt: new Date(), lastError: "", updatedAt: new Date() },
        $unset: { leaseUntil: "", repairShopifyLink: "" },
      },
    );
    return { succeeded: syncedJob.matchedCount === 1 };
  } catch (error) {
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(job.attempts - 1, 5), BACKOFF_MAX_MS);
    await database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").updateOne(
      { _id: job._id, version: job.version, status: "processing" },
      {
        $set: {
          status: "failed",
          lastError: errorMessage(error),
          nextAttemptAt: new Date(Date.now() + backoff),
          updatedAt: new Date(),
        },
        $unset: { leaseUntil: "" },
      },
    );
    return { succeeded: false };
  }
}

export async function syncCustomerShopifyNow(
  customerId: ObjectId,
  deadlineAt = Date.now() + CUSTOMER_SHOPIFY_SYNC_TIMEOUT_MS,
): Promise<ShopifySyncAttemptResult> {
  if (deadlineAt <= Date.now()) {
    return {
      state: "pending",
      lastError: "Sync is queued for a later attempt.",
    };
  }
  const database = await getDatabase();
  const job = await claimNextJob(database, customerId);
  if (job) {
    const outcome = await runSyncJob(database, job, {
      deadlineAt,
    });
    if (outcome.succeeded) return { state: "synced", lastError: "" };
  }

  const current = await database.collection<ShopifySyncJobDocument>("shopify_sync_jobs").findOne({
    _id: customerId,
  });
  if (!current) {
    return { state: "pending", lastError: "Sync job is not currently available." };
  }
  if (current.status === "synced") return { state: "synced", lastError: "" };
  if (current.status === "failed") {
    return { state: "failed", lastError: current.lastError ?? "Shopify sync failed." };
  }
  return {
    state: "pending",
    lastError: current.lastError ?? "",
  };
}

async function deleteDeletedShopifyCustomer(
  database: import("mongodb").Db,
  customerId: ObjectId,
): Promise<void> {
  await Promise.all([
    database.collection("auth_sessions").deleteMany({ customerId }),
    database.collection("password_reset_requests").deleteMany({ customerId }),
    database.collection("password_reset_codes").deleteMany({ customerId }),
    database.collection("status_events").deleteMany({ customerId }),
    database.collection("shopify_sync_jobs").deleteMany({ _id: customerId }),
    database.collection("shopify_orders").deleteMany({ customerId }),
  ]);
  await database.collection<CustomerDocument>("customers").deleteOne({ _id: customerId });
}

async function reconcileShopifyStatus(
  database: Db,
): Promise<{ reconciled: number; failed: number }> {
  const customers = database.collection<CustomerDocument>("customers");
  const events = database.collection<StatusEventDocument>("status_events");
  const state = database.collection<{ _id: string; lastCustomerId?: ObjectId }>("shopify_reconciliation_state");
  const checkpoint = await state.findOne({ _id: "status-tags" });
  const baseFilter: Filter<CustomerDocument> = {
    $or: [
      { shopifyCustomerId: { $type: "string" as const, $ne: "" } },
      { "shop_details.status": { $in: ["approved", "blocked"] } },
    ],
  };
  const customerFilter = {
    ...baseFilter,
    ...(checkpoint?.lastCustomerId ? { _id: { $gt: checkpoint.lastCustomerId } } : {}),
  };
  let batch = await customers.find(customerFilter, {
    projection: {
      mobileNumber: 1,
      shopifyCustomerId: 1,
      "shop_details.status": 1,
      "shop_details.syncVersion": 1,
      "shop_details.contactMobileNumber": 1,
    },
  })
    .sort({ _id: 1 })
    .limit(RECONCILIATION_BATCH_SIZE)
    .toArray();
  if (batch.length === 0 && checkpoint?.lastCustomerId) {
    await state.updateOne(
      { _id: "status-tags" },
      { $unset: { lastCustomerId: "" }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
    batch = await customers.find(
      baseFilter,
      {
        projection: {
          mobileNumber: 1,
          shopifyCustomerId: 1,
          "shop_details.status": 1,
          "shop_details.syncVersion": 1,
        },
      },
    )
      .sort({ _id: 1 })
      .limit(RECONCILIATION_BATCH_SIZE)
      .toArray();
  }
  let reconciled = 0;
  let failed = 0;

  for (const customer of batch) {
    if (!customer.shopifyCustomerId) {
      const phone = customer.shop_details.contactMobileNumber || customer.mobileNumber;
      if (!phone) continue;
      const shopifyCustomerId = await findShopifyCustomerByPhone(phone).catch((error) => {
        throw error;
      });
      if (!shopifyCustomerId) {
        await deleteDeletedShopifyCustomer(database, customer._id);
        reconciled += 1;
        continue;
      }
      await customers.updateOne(
        { _id: customer._id },
        { $set: { shopifyCustomerId } },
      );
      customer.shopifyCustomerId = shopifyCustomerId;
    }
    try {
      const shopifyCustomerName = await getShopifyCustomerName(customer.shopifyCustomerId);
      if (shopifyCustomerName) {
        await customers.updateOne(
          { _id: customer._id },
          { $set: { shopifyCustomerName } },
        );
      }
      const tags = await getShopifyCustomerTags(customer.shopifyCustomerId);
      if (hasShopifyStatusTag(tags, customer.shop_details.status)) continue;
      await writeShopifyStatusTags(
        customer.shopifyCustomerId,
        customer.shop_details.status,
        tags,
      );
      const current = await customers.findOne(
        { _id: customer._id },
        { projection: { "shop_details.status": 1, "shop_details.syncVersion": 1 } },
      );
      if (
        !current ||
        current.shop_details.status !== customer.shop_details.status ||
        current.shop_details.syncVersion !== customer.shop_details.syncVersion
      ) {
        continue;
      }
      await events.insertOne({
        customerId: customer._id,
        staffUserId: null,
        actorLabel: "system: reconciled",
        oldStatus: customer.shop_details.status,
        newStatus: customer.shop_details.status,
        note: "Shopify status tags were reset to match the portal status.",
        eventType: "reconciled",
        createdAt: new Date(),
      });
      reconciled += 1;
    } catch (error) {
      if (error instanceof ShopifyCustomerNotFoundError) {
        await deleteDeletedShopifyCustomer(database, customer._id);
        reconciled += 1;
      } else {
        failed += 1;
      }
    }
  }
  const lastCustomer = batch.at(-1);
  if (lastCustomer) {
    await state.updateOne(
      { _id: "status-tags" },
      { $set: { lastCustomerId: lastCustomer._id, updatedAt: new Date() } },
      { upsert: true },
    );
  }
  return { reconciled, failed };
}

export async function retryCustomerShopifySync(customerId: ObjectId): Promise<void> {
  const database = await getDatabase();
  const customer = await database.collection<CustomerDocument>("customers").findOne(
    { _id: customerId },
    { projection: { "shop_details.syncVersion": 1 } },
  );
  if (!customer) throw new Error("Customer account was not found.");
  await enqueueShopifySync(database, customerId, customer.shop_details.syncVersion, {
    repairShopifyLink: true,
  });
}

export async function runShopifyWorker(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  reconciled: number;
  errors: string[];
}> {
  const database = await getDatabase();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < SYNC_BATCH_SIZE; index += 1) {
    const job = await claimNextJob(database);
    if (!job) break;
    const outcome = await runSyncJob(database, job);
    processed += 1;
    if (outcome.succeeded) succeeded += 1;
    else failed += 1;
  }
  const reconciliation = await reconcileShopifyStatus(database);
  return {
    processed,
    succeeded,
    failed,
    reconciled: reconciliation.reconciled,
    errors: [
      ...(failed > 0 ? ["One or more Shopify sync jobs failed."] : []),
      ...(reconciliation.failed > 0 ? ["Shopify status reconciliation failed."] : []),
    ],
  };
}
