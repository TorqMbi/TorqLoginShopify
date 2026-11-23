import { NextResponse } from "next/server";
import { authorizeStaff, isStaffRequestSameOrigin } from "@/lib/admin-api";
import { CITY_PRICES_COLLECTION, cityKey, cleanCityName } from "@/lib/city-pricing";
import { getDatabase, isDatabaseConfigured, type CityPriceDocument } from "@/lib/db";
import { badOrigin, readJson } from "@/lib/http";

export async function GET() {
  const authorization = await authorizeStaff("admin");
  if (authorization.response) return authorization.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }
  try {
    const cities = await (await getDatabase()).collection<CityPriceDocument>(CITY_PRICES_COLLECTION)
      .find({})
      .sort({ nameKey: 1 })
      .toArray();
    return NextResponse.json({
      cities: cities.map((city) => ({
        id: city._id.toString(),
        name: city.name,
        overrides: city.overrides,
        legacyAdjustmentPercent: city.adjustmentPercent ?? 0,
        updatedAt: city.updatedAt,
        updatedBy: city.updatedBy,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("City price list failed.", error);
    return NextResponse.json({ error: "Unable to load city prices." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isStaffRequestSameOrigin(request)) return badOrigin();
  const authorization = await authorizeStaff("admin");
  if (authorization.response) return authorization.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }
  const body = await readJson(request);
  const name = cleanCityName(body?.name);
  if (!name) {
    return NextResponse.json({ error: "Enter a city name of 2–30 letters." }, { status: 400 });
  }

  try {
    const now = new Date();
    await (await getDatabase()).collection<CityPriceDocument>(CITY_PRICES_COLLECTION).insertOne({
      name,
      nameKey: cityKey(name),
      overrides: [],
      createdAt: now,
      updatedAt: now,
      updatedBy: authorization.staff!.username,
    });
    return NextResponse.json({ message: `${name} price list created.` }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return NextResponse.json({ error: `${name} already has a price list.` }, { status: 409 });
    }
    console.error("City price list creation failed.", error);
    return NextResponse.json({ error: "Unable to create the city price list." }, { status: 500 });
  }
}
