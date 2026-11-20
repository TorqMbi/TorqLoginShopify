import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  generateOtpCode,
  isOtpCodeFormat,
  issuePasswordResetCode,
  OTP_MAX_ATTEMPTS,
  resetPasswordWithCode,
} from "./otp";
import { createFakeDatabase } from "./testing/fake-database";

const MOBILE = "+923001234567";
const NEW_PASSWORD = "a-brand-new-password";

describe("reset code format", () => {
  it("generates six-digit codes, keeping leading zeros", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("accepts only six digits as a code", () => {
    expect(isOtpCodeFormat("012345")).toBe(true);
    expect(isOtpCodeFormat("12345")).toBe(false);
    expect(isOtpCodeFormat("1234567")).toBe(false);
    expect(isOtpCodeFormat("12a456")).toBe(false);
    expect(isOtpCodeFormat(123456)).toBe(false);
  });
});

describe("password reset by code", () => {
  let fake: ReturnType<typeof createFakeDatabase>;
  let customerId: ObjectId;
  const now = new Date("2026-11-20T10:00:00Z");

  beforeEach(() => {
    fake = createFakeDatabase();
    customerId = new ObjectId();
    fake.collection("customers").docs.push({
      _id: customerId,
      mobileNumber: MOBILE,
      passwordHash: "old-hash",
      sessionVersion: 3,
      passwordResetTokenHash: "staff-link-hash",
      passwordResetExpiresAt: new Date(now.getTime() + 60_000),
    });
    fake.collection("auth_sessions").docs.push({ _id: new ObjectId(), customerId, tokenHash: "session" });
  });

  it("does not create a code for an unregistered number", async () => {
    await expect(issuePasswordResetCode(fake.database, "+923009999999", now)).resolves.toBeNull();
    expect(fake.collection("password_reset_codes").docs).toHaveLength(0);
  });

  it("stores only a scrambled code that expires after 10 minutes", async () => {
    const issued = await issuePasswordResetCode(fake.database, MOBILE, now);
    const [stored] = fake.collection("password_reset_codes").docs;
    expect(issued?.code).toMatch(/^\d{6}$/);
    expect(Object.values(stored)).not.toContain(issued?.code);
    expect(stored.attempts).toBe(0);
    expect(stored.expiresAt).toEqual(new Date(now.getTime() + 10 * 60 * 1000));
  });

  it("keeps only the newest code", async () => {
    const first = await issuePasswordResetCode(fake.database, MOBILE, now);
    const second = await issuePasswordResetCode(fake.database, MOBILE, now);
    expect(fake.collection("password_reset_codes").docs).toHaveLength(1);
    if (first!.code !== second!.code) {
      await expect(
        resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: first!.code, password: NEW_PASSWORD }, now),
      ).resolves.toBe("invalid");
    }
    await expect(
      resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: second!.code, password: NEW_PASSWORD }, now),
    ).resolves.toBe("reset");
  });

  it("sets the new password, signs out every device and retires the code and staff link", async () => {
    const issued = await issuePasswordResetCode(fake.database, MOBILE, now);
    const result = await resetPasswordWithCode(
      fake.database,
      { mobileNumber: MOBILE, code: issued!.code, password: NEW_PASSWORD },
      now,
    );
    expect(result).toBe("reset");

    const [customer] = fake.collection("customers").docs;
    expect(await bcrypt.compare(NEW_PASSWORD, String(customer.passwordHash))).toBe(true);
    expect(customer.sessionVersion).toBe(4);
    expect(customer.passwordResetTokenHash).toBeUndefined();
    expect(customer.passwordResetExpiresAt).toBeUndefined();
    expect(fake.collection("auth_sessions").docs).toHaveLength(0);
    expect(fake.collection("password_reset_codes").docs).toHaveLength(0);

    await expect(
      resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: issued!.code, password: NEW_PASSWORD }, now),
    ).resolves.toBe("invalid");
  });

  it("rejects a wrong code and counts the try", async () => {
    const issued = await issuePasswordResetCode(fake.database, MOBILE, now);
    const wrongCode = issued!.code === "000000" ? "111111" : "000000";
    await expect(
      resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: wrongCode, password: NEW_PASSWORD }, now),
    ).resolves.toBe("invalid");
    expect(fake.collection("password_reset_codes").docs[0].attempts).toBe(1);
    expect(fake.collection("customers").docs[0].passwordHash).toBe("old-hash");
  });

  it(`locks the code after ${OTP_MAX_ATTEMPTS} wrong tries, even for the right code`, async () => {
    const issued = await issuePasswordResetCode(fake.database, MOBILE, now);
    const wrongCode = issued!.code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      await resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: wrongCode, password: NEW_PASSWORD }, now);
    }
    await expect(
      resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: issued!.code, password: NEW_PASSWORD }, now),
    ).resolves.toBe("invalid");
    expect(fake.collection("customers").docs[0].passwordHash).toBe("old-hash");
  });

  it("rejects an expired code", async () => {
    const issued = await issuePasswordResetCode(fake.database, MOBILE, now);
    const later = new Date(now.getTime() + 10 * 60 * 1000 + 1);
    await expect(
      resetPasswordWithCode(fake.database, { mobileNumber: MOBILE, code: issued!.code, password: NEW_PASSWORD }, later),
    ).resolves.toBe("invalid");
  });

  it("gives the same answer for an unregistered number", async () => {
    await expect(
      resetPasswordWithCode(fake.database, { mobileNumber: "+923009999999", code: "123456", password: NEW_PASSWORD }, now),
    ).resolves.toBe("invalid");
  });
});
