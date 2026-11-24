import { NextResponse } from "next/server";
import { getDatabase, isDatabaseConfigured } from "@/lib/db";
import { badOrigin, isSameOrigin, readJson } from "@/lib/http";
import { isOtpCodeFormat, OTP_MAX_ATTEMPTS, resetPasswordWithCode } from "@/lib/otp";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { isValidPassword, normalizeMobile } from "@/lib/validation";

const INVALID_CODE = `The code is wrong or has expired. After ${OTP_MAX_ATTEMPTS} wrong tries, request a new code.`;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return badOrigin();
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }

  const body = await readJson(request);
  const mobileNumber = normalizeMobile(body?.mobileNumber);
  if (!body || !mobileNumber) {
    return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
  }
  if (!isOtpCodeFormat(body.code)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }
  if (!isValidPassword(body.password)) {
    return NextResponse.json({ error: "Password must be between 12 and 72 characters." }, { status: 400 });
  }
  if (body.password !== body.confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  try {
    const database = await getDatabase();
    if (!(await consumeRateLimit(database, `otp-verify:ip:${getClientIp(request)}`, 20, 15 * 60 * 1000))) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const result = await resetPasswordWithCode(database, {
      mobileNumber,
      code: body.code,
      password: body.password,
    });
    if (result !== "reset") {
      return NextResponse.json({ error: INVALID_CODE }, { status: 400 });
    }
    return NextResponse.json({ message: "Password updated." });
  } catch (error) {
    console.error("Password reset by code failed.", error);
    return NextResponse.json({ error: "Unable to update your password right now." }, { status: 500 });
  }
}
