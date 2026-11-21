import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { destroySession, getSession } from "@/lib/auth";
import { resolveDetailsCity } from "@/lib/city-pricing";
import { parseCustomerShopDetails } from "@/lib/customer-shop-details";
import { getDatabase, isDatabaseConfigured, type CustomerDocument } from "@/lib/db";
import { badOrigin, isSameOrigin, readJson } from "@/lib/http";
import {
  enqueueShopifySync,
  syncCustomerShopifyNow,
  CUSTOMER_SHOPIFY_SYNC_TIMEOUT_MS,
  type ShopifySyncAttemptResult,
} from "@/lib/shopify-outbox";

export async function PATCH(request: Request) {
  const syncDeadlineAt = Date.now() + CUSTOMER_SHOPIFY_SYNC_TIMEOUT_MS;
  if (!isSameOrigin(request)) return badOrigin();
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }
  const session = await getSession();
  if (session?.role !== "customer" || !session.customerId) {
    return NextResponse.json({ error: "Sign in to update your account details." }, { status: 401 });
  }

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Please submit a valid form." }, { status: 400 });

  const parsedDetails = parseCustomerShopDetails(body);
  if ("error" in parsedDetails) {
    return NextResponse.json({ error: parsedDetails.error }, { status: 400 });
  }
  const details = parsedDetails.details;

  try {
    const database = await getDatabase();
    const now = new Date();
    const customerId = new ObjectId(session.customerId);
    const cityChoice = await resolveDetailsCity(database, customerId, details.city);
    if ("error" in cityChoice) {
      return NextResponse.json({ error: cityChoice.error }, { status: 409 });
    }
    details.city = cityChoice.city;
    const clientSession = database.client.startSession();
    let matchedCount = 0;
    let wasCompleted = false;
    try {
      const existingCustomer = await database.collection<CustomerDocument>("customers").findOne(
        { _id: customerId },
        { projection: { "shop_details.completedAt": 1 }, session: clientSession },
      );
      wasCompleted = Boolean(existingCustomer?.shop_details.completedAt);
      await clientSession.withTransaction(async () => {
        const updated = await database.collection<CustomerDocument>("customers").updateOne(
          { _id: customerId },
          [
            {
              $set: {
                "shop_details.contactPersonName": details.contactPersonName,
                "shop_details.shopName": details.shopName,
                "shop_details.contactMobileNumber": details.contactMobileNumber,
                "shop_details.alternateMobileNumber": details.alternateMobileNumber,
                "shop_details.shopAddress": details.shopAddress,
                "shop_details.detailedAddress": details.detailedAddress,
                "shop_details.city": details.city,
                "shop_details.province": details.province,
                "shop_details.comments": details.comments,
                "shop_details.updatedAt": now,
                "shop_details.completedAt": { $ifNull: ["$shop_details.completedAt", now] },
                "shop_details.syncVersion": {
                  $add: [{ $ifNull: ["$shop_details.syncVersion", 0] }, 1],
                },
              },
            },
          ],
          { session: clientSession },
        );
        matchedCount = updated.matchedCount;
        if (matchedCount === 0) return;
        const customer = await database.collection<CustomerDocument>("customers").findOne(
          { _id: customerId },
          { projection: { "shop_details.syncVersion": 1 }, session: clientSession },
        );
        if (!customer) throw new Error("Customer account was not found after saving details.");
        await enqueueShopifySync(
          database,
          customerId,
          customer.shop_details.syncVersion,
          clientSession,
        );
      });
    } finally {
      await clientSession.endSession();
    }
    if (matchedCount === 0) {
      return NextResponse.json({ error: "Customer account was not found." }, { status: 404 });
    }
    if (!wasCompleted) await destroySession();
    let shopifySync: ShopifySyncAttemptResult = {
      state: "pending",
      lastError: "Sync is queued for a later attempt.",
    };
    try {
      shopifySync = await syncCustomerShopifyNow(customerId, syncDeadlineAt);
    } catch {
      // The local save and outbox job are already committed.
    }
    return NextResponse.json({
      message: "Your details have been saved.",
      shopifySync,
    });
  } catch (error) {
    console.error("Customer details update failed.", error);
    return NextResponse.json({ error: "Unable to save your details. Please try again." }, { status: 500 });
  }
}
