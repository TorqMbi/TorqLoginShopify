import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Db } from "mongodb";
import type { AuthRateLimitDocument } from "@/lib/db";

export function getClientIp(request: Request): string {
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (forwardedIp && isIP(forwardedIp)) return forwardedIp;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;
  return "unknown";
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/**
 * Counts one attempt against a fixed time window and reports whether it is
 * still within `limit`. Keys are hashed so phone numbers and IPs are not
 * stored in readable form.
 */
export async function consumeRateLimit(
  database: Db,
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = createHash("sha256").update(`${key}:${windowStart}`).digest("hex");
  const expiresAt = new Date(windowStart + windowMs + 60_000);
  const limits = database.collection<AuthRateLimitDocument>("auth_rate_limits");

  let updated: AuthRateLimitDocument | null;
  try {
    updated = await limits.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    updated = await limits.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 } },
      { returnDocument: "after" },
    );
  }
  return (updated?.count ?? limit + 1) <= limit;
}
