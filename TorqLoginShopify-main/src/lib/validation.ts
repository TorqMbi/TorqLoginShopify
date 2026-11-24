// Customers usually type Pakistani numbers in local form (0300 1234567,
// 300 1234567 or +92 0300 1234567); all of these mean +92 300 1234567.
const PAKISTANI_MOBILE = /^(?:\+?92)?0?(3\d{9})$/;

export function normalizeMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let compact = value.trim().replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  const pakistani = PAKISTANI_MOBILE.exec(compact);
  if (pakistani) return `+92${pakistani[1]}`;
  const normalized = compact.startsWith("+") ? compact : `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function isValidUsername(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 3 &&
    value.trim().length <= 32 &&
    /^[a-zA-Z0-9._-]+$/.test(value.trim())
  );
}

export function isValidPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    Buffer.byteLength(value, "utf8") <= 72
  );
}
