import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { authorizeStaff, isStaffRequestSameOrigin } from "@/lib/admin-api";
import {
  CITY_PRICES_COLLECTION,
  MAX_ADJUSTMENT_PERCENT,
  MAX_PRICE_OVERRIDES,
  MIN_ADJUSTMENT_PERCENT,
  parseAdjustmentPercent,
  parsePriceOverrides,
} from "@/lib/city-pricing";
import { getDatabase, isDatabaseConfigured, type CityPriceDocument } from "@/lib/db";
import { badOrigin, readJson } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = "City price list was not found.";

async function authorize(request: Request) {
  if (!isStaffRequestSameOrigin(request)) return { response: badOrigin(), staff: null };
  const authorization = await authorizeStaff("admin");
  if (authorization.response) return authorization;
  if (!isDatabaseConfigured()) {
    return {
      staff: null,
      response: NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 }),
    };
  }
  return authorization;
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!/^[\da-f]{24}$/i.test(id)) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const body = await readJson(request);
  const adjustmentPercent = parseAdjustmentPercent(body?.adjustmentPercent);
  if (adjustmentPercent === null) {
    return NextResponse.json(
      { error: `Enter an adjustment between ${MIN_ADJUSTMENT_PERCENT}% and +${MAX_ADJUSTMENT_PERCENT}%.` },
      { status: 400 },
    );
  }
  const overrides = parsePriceOverrides(body?.overrides);
  if (overrides === null) {
    return NextResponse.json(
      { error: `Each exact price must be more than 0, for up to ${MAX_PRICE_OVERRIDES.toLocaleString("en-US")} products.` },
      { status: 400 },
    );
  }

  try {
    const result = await (await getDatabase()).collection<CityPriceDocument>(CITY_PRICES_COLLECTION).findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          adjustmentPercent,
          overrides,
          updatedAt: new Date(),
          updatedBy: authorization.staff!.username,
        },
      },
      { returnDocument: "after", projection: { name: 1 } },
    );
    if (!result) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json({ message: `${result.name} prices saved.` });
  } catch (error) {
    console.error("City price list update failed.", error);
    return NextResponse.json({ error: "Unable to save city prices." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = await authorize(request);
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!/^[\da-f]{24}$/i.test(id)) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  try {
    const removed = await (await getDatabase()).collection<CityPriceDocument>(CITY_PRICES_COLLECTION).findOneAndDelete(
      { _id: new ObjectId(id) },
      { projection: { name: 1 } },
    );
    if (!removed) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json({
      message: `${removed.name} price list deleted. Shops in ${removed.name} now see standard Shopify prices.`,
    });
  } catch (error) {
    console.error("City price list deletion failed.", error);
    return NextResponse.json({ error: "Unable to delete the city price list." }, { status: 500 });
  }
}
