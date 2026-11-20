import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db, ObjectId } from "mongodb";
import type { CustomerDocument, PasswordResetCodeDocument } from "@/lib/db";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function isOtpCodeFormat(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export function hashOtpCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function codeMatches(code: string, record: Pick<PasswordResetCodeDocument, "codeHash" | "salt">): boolean {
  const actual = Buffer.from(hashOtpCode(code, record.salt), "hex");
  const expected = Buffer.from(record.codeHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/**
 * Creates a fresh code for a registered number, replacing any earlier code so
 * only the newest one works. Returns null when the number is not registered;
 * callers must answer the same way in both cases.
 */
export async function issuePasswordResetCode(
  database: Db,
  mobileNumber: string,
  now: Date = new Date(),
): Promise<{ customerId: ObjectId; code: string } | null> {
  const customer = await database
    .collection<CustomerDocument>("customers")
    .findOne({ mobileNumber }, { projection: { _id: 1 } });
  if (!customer) return null;

  const code = generateOtpCode();
  const salt = randomBytes(16).toString("hex");
  const record = {
    codeHash: hashOtpCode(code, salt),
    salt,
    attempts: 0,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    createdAt: now,
  };
  const codes = database.collection<PasswordResetCodeDocument>("password_reset_codes");
  try {
    await codes.updateOne({ customerId: customer._id }, { $set: record }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await codes.updateOne({ customerId: customer._id }, { $set: record });
  }
  return { customerId: customer._id, code };
}

export async function discardPasswordResetCode(database: Db, customerId: ObjectId): Promise<void> {
  await database
    .collection<PasswordResetCodeDocument>("password_reset_codes")
    .deleteOne({ customerId });
}

/**
 * Checks a code and, when it is right, sets the new password, signs the
 * account out everywhere and makes the code (and any staff reset link)
 * unusable. Every failure returns "invalid" so the reply never reveals
 * whether a number is registered.
 */
export async function resetPasswordWithCode(
  database: Db,
  input: { mobileNumber: string; code: string; password: string },
  now: Date = new Date(),
): Promise<"reset" | "invalid"> {
  const customers = database.collection<CustomerDocument>("customers");
  const customer = await customers.findOne(
    { mobileNumber: input.mobileNumber },
    { projection: { _id: 1 } },
  );
  if (!customer) return "invalid";

  const codes = database.collection<PasswordResetCodeDocument>("password_reset_codes");
  const record = await codes.findOneAndUpdate(
    {
      customerId: customer._id,
      expiresAt: { $gt: now },
      attempts: { $lt: OTP_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!record || !codeMatches(input.code, record)) return "invalid";

  const consumed = await codes.deleteOne({ _id: record._id, codeHash: record.codeHash });
  if (consumed.deletedCount !== 1) return "invalid";

  const passwordHash = await bcrypt.hash(input.password, 12);
  await customers.updateOne(
    { _id: customer._id },
    {
      $set: { passwordHash },
      $inc: { sessionVersion: 1 },
      $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" },
    },
  );
  await database.collection("auth_sessions").deleteMany({ customerId: customer._id });
  return "reset";
}
