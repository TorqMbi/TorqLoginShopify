import { describe, expect, it } from "vitest";
import { consumeRateLimit, getClientIp } from "./rate-limit";
import { createFakeDatabase } from "./testing/fake-database";

describe("consumeRateLimit", () => {
  const minute = 60_000;
  const now = Date.UTC(2026, 10, 20, 10, 0, 0);

  it("allows up to the limit within one window, then blocks", async () => {
    const { database } = createFakeDatabase();
    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await consumeRateLimit(database, "key", 3, minute, now));
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("starts counting again in the next window", async () => {
    const { database } = createFakeDatabase();
    await consumeRateLimit(database, "key", 1, minute, now);
    await expect(consumeRateLimit(database, "key", 1, minute, now)).resolves.toBe(false);
    await expect(consumeRateLimit(database, "key", 1, minute, now + minute)).resolves.toBe(true);
  });

  it("keeps separate counts per key and does not store the key in readable form", async () => {
    const fake = createFakeDatabase();
    await consumeRateLimit(fake.database, "otp-send:number:+923001234567", 1, minute, now);
    await expect(consumeRateLimit(fake.database, "otp-send:number:+923007654321", 1, minute, now)).resolves.toBe(true);
    const ids = fake.collection("auth_rate_limits").docs.map((doc) => String(doc._id));
    expect(ids.join(" ")).not.toContain("923001234567");
  });
});

describe("getClientIp", () => {
  const request = (headers: Record<string, string>) => new Request("https://example.com", { headers });

  it("uses the address added by the hosting proxy", () => {
    expect(getClientIp(request({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to unknown", () => {
    expect(getClientIp(request({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(getClientIp(request({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(getClientIp(request({}))).toBe("unknown");
  });
});
