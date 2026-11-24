import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { hashToken } from "@/lib/auth";
import { getDatabase, isDatabaseConfigured, type CustomerDocument } from "@/lib/db";
import { badOrigin, isSameOrigin, readJson } from "@/lib/http";
import { isValidPassword } from "@/lib/validation";
import { normalizeMobile } from "@/lib/validation";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return badOrigin();
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }
  const body = await readJson(request);
  if (
    typeof body?.mobileNumber === "string" &&
    typeof body?.shopName === "string" &&
    typeof body?.city === "string"
  ) {
    const mobileNumber = normalizeMobile(body.mobileNumber);
    if (!mobileNumber) {
      return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
    }
    if (!isValidPassword(body.password)) {
      return NextResponse.json({ error: "Password must be between 12 and 72 characters." }, { status: 400 });
    }
    if (body.password !== body.confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
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
      if (
        customer?.passwordResetIdentityLockedUntil &&
        customer.passwordResetIdentityLockedUntil > now
      ) {
        return NextResponse.json(
          { error: "Password reset is locked for this account for 24 hours. Please try again later." },
          { status: 429 },
        );
      }
      const matches = Boolean(
        customer &&
        (customer.shop_details?.shopName ?? "").trim().toLowerCase() === body.shopName.trim().toLowerCase() &&
        (customer.shop_details?.city ?? "").trim().toLowerCase() === body.city.trim().toLowerCase(),
      );
      if (!customer || !matches) {
        if (customer) {
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
        }
        return NextResponse.json({ error: "The account details do not match." }, { status: 400 });
      }

      const passwordHash = await bcrypt.hash(body.password, 12);
      await database.collection<CustomerDocument>("customers").updateOne(
        { _id: customer._id },
        {
          $set: { passwordHash },
          $inc: { sessionVersion: 1 },
          $unset: {
            passwordResetTokenHash: "",
            passwordResetExpiresAt: "",
            passwordResetIdentityAttempts: "",
            passwordResetIdentityLockedUntil: "",
          },
        },
      );
      await database.collection("auth_sessions").deleteMany({ customerId: customer._id });
      return NextResponse.json({ message: "Password updated." });
    } catch (error) {
      console.error("Password identity reset failed.", error);
      return NextResponse.json({ error: "Unable to update your password right now." }, { status: 500 });
    }
  }

  if (!body || typeof body.token !== "string" || !body.token) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }
  const token = body.token;
  if (!isValidPassword(body.password)) {
    return NextResponse.json({ error: "Password must be between 12 and 72 characters." }, { status: 400 });
  }
  if (body.password !== body.confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  try {
    const passwordHash = await bcrypt.hash(body.password, 12);
    const database = await getDatabase();
    const result = await database.collection<CustomerDocument>("customers").findOneAndUpdate(
      {
        passwordResetTokenHash: hashToken(token),
        passwordResetExpiresAt: { $gt: new Date() },
      },
      {
        $set: { passwordHash },
        $inc: { sessionVersion: 1 },
        $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" },
      },
      { returnDocument: "before", projection: { _id: 1 } },
    );

    if (!result) {
      return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    }
    await database.collection("auth_sessions").deleteMany({ customerId: result._id });
    return NextResponse.json({ message: "Password updated." });
  } catch (error) {
    console.error("Password update failed.", error);
    return NextResponse.json({ error: "Unable to update your password right now." }, { status: 500 });
  }
}
