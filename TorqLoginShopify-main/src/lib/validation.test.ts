import { describe, expect, it } from "vitest";
import { normalizeMobile } from "./validation";

describe("normalizeMobile", () => {
  it.each([
    "+923001234567",
    "+92 300 1234567",
    "923001234567",
    "03001234567",
    "0300-1234567",
    "0300 123 4567",
    "3001234567",
    "+92 0300 1234567",
    "00923001234567",
    "(0300) 1234567",
  ])("reads the Pakistani number %s as +923001234567", (input) => {
    expect(normalizeMobile(input)).toBe("+923001234567");
  });

  it("keeps other international numbers unchanged", () => {
    expect(normalizeMobile("+447700900123")).toBe("+447700900123");
    expect(normalizeMobile("447700900123")).toBe("+447700900123");
    expect(normalizeMobile("0044 7700 900123")).toBe("+447700900123");
  });

  it.each([
    "",
    "   ",
    "0300123456",
    "030012345678",
    "+0300 1234567",
    "abc",
    "+92300123456a",
  ])("rejects the invalid value %j", (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });

  it("rejects values that are not strings", () => {
    expect(normalizeMobile(undefined)).toBeNull();
    expect(normalizeMobile(3001234567)).toBeNull();
  });
});
