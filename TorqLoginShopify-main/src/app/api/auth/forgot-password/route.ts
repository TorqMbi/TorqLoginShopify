import { NextResponse } from "next/server";
import { getDatabase, isDatabaseConfigured, type CustomerDocument, type PasswordResetRequestDocument } from "@/lib/db";
import { badOrigin, isSameOrigin, readJson } from "@/lib/http";
import { normalizeMobile } from "@/lib/validation";

const confirmation =
  "If this number is registered, your reset request has been received. Our team will verify the account and send a secure WhatsApp reset link shortly.";

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return badOrigin();
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }

  const body = await readJson(request);
  const mobileNumber = normalizeMobile(body?.mobileNumber);
  if (!mobileNumber) {
    return NextResponse.json({ error: "Enter a valid mobile number in international format." }, { status: 400 });
  }

  const hasIdentityFields =
    typeof body?.shopName === "string" && typeof body?.city === "string";
  if (hasIdentityFields) {
    const shopName = (body.shopName as string).trim();
    const city = (body.city as string).trim();
    if (!shopName || !city) {
      return NextResponse.json({ error: "Enter both your shop name and city." }, { status: 400 });
    }

    try {
      const database = await getDatabase();
      const now = new Date();
      const customer = await database.collection<CustomerDocument>("customers").findOne(
        { mobileNumber },
        {
          projection: {
            _id: 1,
            shop_details: 1,
            passwordResetIdentityAttempts: 1,
            passwordResetIdentityLockedUntil: 1,
          },
        },
      );
      if (!customer) {
        return NextResponse.json({ error: "The account details do not match." }, { status: 400 });
      }
      if (
        customer.passwordResetIdentityLockedUntil &&
        customer.passwordResetIdentityLockedUntil > now
      ) {
        return NextResponse.json(
          {
            error: "Password reset is locked for this account for 24 hours. Please try again later.",
          },
          { status: 429 },
        );
      }

      const matches =
        (customer.shop_details?.shopName ?? "").trim().toLowerCase() === shopName.toLowerCase() &&
        (customer.shop_details?.city ?? "").trim().toLowerCase() === city.toLowerCase();

      if (!matches) {
        const attempts = (customer.passwordResetIdentityAttempts ?? 0) + 1;
        const update: {
          $set: { passwordResetIdentityAttempts: number; passwordResetIdentityLockedUntil?: Date };
        } = { $set: { passwordResetIdentityAttempts: attempts } };
        if (attempts >= 3) {
          update.$set.passwordResetIdentityLockedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          update.$set.passwordResetIdentityAttempts = 0;
        }
        await database.collection<CustomerDocument>("customers").updateOne(
          { _id: customer._id },
          update,
        );
        if (attempts >= 3) {
          return NextResponse.json(
            { error: "Too many incorrect attempts. Password reset is locked for 24 hours." },
            { status: 429 },
          );
        }
        return NextResponse.json(
          { error: "The account details do not match. Check your shop name and city." },
          { status: 400 },
        );
      }

      await database.collection<CustomerDocument>("customers").updateOne(
        { _id: customer._id },
        { $unset: { passwordResetIdentityAttempts: "", passwordResetIdentityLockedUntil: "" } },
      );
      return NextResponse.json({ verified: true, message: "Account details verified." });
    } catch (error) {
      console.error("Password reset identity verification failed.", error);
      return NextResponse.json({ error: "Unable to verify your account right now." }, { status: 500 });
    }
  }

  try {
    const database = await getDatabase();
    const customer = await database.collection<CustomerDocument>("customers").findOne(
      { mobileNumber },
      { projection: { _id: 1 } },
    );

    if (customer) {
      const requests = database.collection<PasswordResetRequestDocument>("password_reset_requests");
      const now = new Date();
      const [recentCount, dailyCount] = await Promise.all([
        requests.countDocuments({
          customerId: customer._id,
          createdAt: { $gte: new Date(now.getTime() - 15 * 60 * 1000) },
        }),
        requests.countDocuments({
          customerId: customer._id,
          createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        }),
      ]);

      if (recentCount < 3 && dailyCount < 5) {
        try {
          await requests.insertOne({
            customerId: customer._id,
            mobileNumber,
            status: "pending",
            createdAt: now,
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }
      }
    }

    return NextResponse.json({ message: confirmation });
  } catch (error) {
    console.error("Password reset request creation failed.", error);
    return NextResponse.json({ error: "Unable to submit your request right now." }, { status: 500 });
  }
}
