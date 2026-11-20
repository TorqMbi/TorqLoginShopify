import { after, NextResponse } from "next/server";
import { getDatabase, isDatabaseConfigured } from "@/lib/db";
import { badOrigin, isSameOrigin, readJson } from "@/lib/http";
import { discardPasswordResetCode, issuePasswordResetCode, OTP_TTL_MINUTES } from "@/lib/otp";
import { getOtpSender } from "@/lib/otp-delivery";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { normalizeMobile } from "@/lib/validation";

const MINUTE = 60 * 1000;
const RESEND_AFTER_SECONDS = 60;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return badOrigin();
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "MongoDB storage is not configured on the server." }, { status: 503 });
  }
  const sender = getOtpSender();
  if (!sender) {
    return NextResponse.json({ error: "Password reset by code is not available right now." }, { status: 503 });
  }

  const body = await readJson(request);
  const mobileNumber = normalizeMobile(body?.mobileNumber);
  if (!mobileNumber) {
    return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
  }

  try {
    const database = await getDatabase();
    if (!(await consumeRateLimit(database, `otp-send:ip:${getClientIp(request)}`, 10, 60 * MINUTE))) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    // Per-number limits apply whether or not the number is registered, and a
    // blocked request still gets the normal reply, so nothing reveals which
    // numbers have accounts.
    const numberKey = `otp-send:number:${mobileNumber}`;
    const withinNumberLimits =
      (await consumeRateLimit(database, `${numberKey}:minute`, 1, MINUTE)) &&
      (await consumeRateLimit(database, `${numberKey}:quarter-hour`, 3, 15 * MINUTE)) &&
      (await consumeRateLimit(database, `${numberKey}:day`, 5, 24 * 60 * MINUTE));

    if (withinNumberLimits) {
      const issued = await issuePasswordResetCode(database, mobileNumber);
      if (issued) {
        // Sent after the reply so registered and unregistered numbers take the same time.
        after(async () => {
          try {
            await sender.send(mobileNumber, issued.code);
          } catch (error) {
            console.error("Password reset code delivery failed.", error);
            await discardPasswordResetCode(database, issued.customerId).catch(() => undefined);
          }
        });
      }
    }

    const channel = sender.channel === "whatsapp" ? "by WhatsApp" : "(development: see the server console)";
    return NextResponse.json({
      message: `If this number is registered, we've sent a 6-digit code ${channel}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      resendAfterSeconds: RESEND_AFTER_SECONDS,
    });
  } catch (error) {
    console.error("Password reset code request failed.", error);
    return NextResponse.json({ error: "Unable to send a code right now. Please try again." }, { status: 500 });
  }
}
