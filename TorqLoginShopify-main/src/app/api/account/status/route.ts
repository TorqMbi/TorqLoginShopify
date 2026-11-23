import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getSession } from "@/lib/auth";
import { getDatabase, isDatabaseConfigured, type CustomerDocument } from "@/lib/db";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Account status is unavailable." }, { status: 503 });
  }

  const session = await getSession();
  if (session?.role !== "customer" || !session.customerId) {
    return NextResponse.json({ error: "Sign in to view your account status." }, { status: 401 });
  }

  try {
    const database = await getDatabase();
    const customer = await database.collection<CustomerDocument>("customers").findOne(
      { _id: new ObjectId(session.customerId) },
      {
        projection: {
          "shop_details.status": 1,
          "shop_details.syncVersion": 1,
          "shop_details.completedAt": 1,
        },
      },
    );
    if (!customer) {
      return NextResponse.json({ error: "Customer account was not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        status: customer.shop_details.status,
        syncVersion: customer.shop_details.syncVersion,
        completed: Boolean(customer.shop_details.completedAt),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Customer account status request failed.", error);
    return NextResponse.json({ error: "Unable to load account status." }, { status: 500 });
  }
}
