import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Collection } from "mongodb";
import { NextResponse } from "next/server";
import {
  getDatabase,
  isDatabaseConfigured,
  type ContactRateLimitDocument,
  type ContactSubmissionKeyDocument,
} from "@/lib/db";
import { badOrigin, isSameOrigin, readJson } from "@/lib/http";
import { createShopifyCustomerQuery, hasShopifyMetaobjectWriteScope } from "@/lib/shopify";
import { normalizeMobile } from "@/lib/validation";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const SUBMISSION_LEASE_MS = 30 * 1000;
const SUBMISSION_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUEST_BYTES = 24_000;

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function getClientIp(request: Request): string | null {
  if (process.env.NETLIFY === "true") {
    const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
    if (netlifyIp) return isIP(netlifyIp) ? netlifyIp : null;
  }

  const forwardedIps = request.headers.get("x-forwarded-for")?.split(",");
  const forwardedIp = forwardedIps?.at(-1)?.trim();
  if (forwardedIp) return isIP(forwardedIp) ? forwardedIp : null;
  if (process.env.NODE_ENV === "production") return null;
  return "local";
}

function readContactFields(body: Record<string, unknown> | null) {
  if (!body) return { error: "Please submit a valid form." } as const;
  if (body.website !== undefined && body.website !== null && String(body.website).trim()) {
    return { error: "Please submit a valid form." } as const;
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = normalizeMobile(body.phone);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";

  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { error: "Enter your name (2 to 120 characters)." } as const;
  }
  if (!phone) {
    return { error: "Enter a valid mobile / WhatsApp number with its country code." } as const;
  }
  if (
    message.length < 5 ||
    message.length > 5_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)
  ) {
    return { error: "Your message must be between 5 and 5,000 characters." } as const;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
    return { error: "Please refresh the page and try again." } as const;
  }

  return { name, phone, message, submissionId: submissionId.toLowerCase() } as const;
}

async function claimSubmission(
  submissionKeys: Collection<ContactSubmissionKeyDocument>,
  submissionId: string,
  payloadHash: string,
  now: Date,
) {
  const leaseId = randomUUID();
  const expiresAt = new Date(now.getTime() + SUBMISSION_KEY_TTL_MS);
  const leaseUntil = new Date(now.getTime() + SUBMISSION_LEASE_MS);

  try {
    await submissionKeys.insertOne({
      _id: submissionId,
      state: "processing",
      leaseId,
      leaseUntil,
      payloadHash,
      submittedAt: now,
      createdAt: now,
      expiresAt,
    });
    return { kind: "claimed" as const, leaseId, isNew: true, submittedAt: now };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const existing = await submissionKeys.findOne({ _id: submissionId });
  if (existing?.payloadHash !== payloadHash) return { kind: "conflict" as const };
  if (existing?.state === "saved") return { kind: "saved" as const };

  const claimed = await submissionKeys.findOneAndUpdate(
    { _id: submissionId, state: "processing", payloadHash, leaseUntil: { $lte: now } },
    { $set: { leaseId, leaseUntil, expiresAt } },
    { returnDocument: "after" },
  );
  if (claimed) {
    return {
      kind: "claimed" as const,
      leaseId,
      isNew: false,
      submittedAt: claimed.submittedAt,
    };
  }
  return { kind: "processing" as const };
}

async function incrementRateLimit(
  database: Awaited<ReturnType<typeof getDatabase>>,
  ip: string,
  now: Date,
) {
  const window = Math.floor(now.getTime() / RATE_LIMIT_WINDOW_MS);
  const windowEnd = new Date((window + 1) * RATE_LIMIT_WINDOW_MS);
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const id = `${ipHash}:${window}`;
  const expiresAt = new Date(windowEnd.getTime() + RATE_LIMIT_WINDOW_MS);
  const limits = database.collection<ContactRateLimitDocument>("contact_rate_limits");
  try {
    const updated = await limits.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after" },
    );
    return { count: updated?.count ?? RATE_LIMIT_MAX + 1, windowEnd };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const updated = await limits.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 } },
      { returnDocument: "after" },
    );
    return { count: updated?.count ?? RATE_LIMIT_MAX + 1, windowEnd };
  }
}

async function releaseSubmission(
  submissions: Collection<ContactSubmissionKeyDocument>,
  submissionId: string,
  leaseId: string,
): Promise<void> {
  try {
    await submissions.deleteOne({ _id: submissionId, leaseId });
  } catch (error) {
    console.error("Contact submission key cleanup failed.", error);
  }
}

async function expireSubmissionLease(
  submissions: Collection<ContactSubmissionKeyDocument>,
  submissionId: string,
  leaseId: string,
): Promise<void> {
  try {
    await submissions.updateOne(
      { _id: submissionId, state: "processing", leaseId },
      { $set: { leaseUntil: new Date(0) } },
    );
  } catch (error) {
    console.error("Contact submission retry lease cleanup failed.", error);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return badOrigin();
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "The submitted form is too large." }, { status: 413 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Inquiry storage is not configured on the server." }, { status: 503 });
  }

  const fields = readContactFields(await readJson(request));
  if ("error" in fields) {
    return NextResponse.json({ error: fields.error }, { status: 400 });
  }

  const clientIp = getClientIp(request);
  if (!clientIp) {
    return NextResponse.json({ error: "Unable to process your request right now. Please try again." }, { status: 503 });
  }

  let database: Awaited<ReturnType<typeof getDatabase>>;
  try {
    database = await getDatabase();
  } catch (error) {
    console.error("Contact inquiry storage is unavailable.", error);
    return NextResponse.json({ error: "Unable to submit your message right now. Please try again." }, { status: 503 });
  }

  const submissions = database.collection<ContactSubmissionKeyDocument>("contact_submission_keys");
  const now = new Date();
  const payloadHash = createHash("sha256")
    .update(JSON.stringify([fields.name, fields.phone, fields.message]))
    .digest("hex");
  let claim: Awaited<ReturnType<typeof claimSubmission>>;
  try {
    claim = await claimSubmission(submissions, fields.submissionId, payloadHash, now);
  } catch (error) {
    console.error("Contact inquiry idempotency check failed.", error);
    return NextResponse.json({ error: "Unable to submit your message right now. Please try again." }, { status: 503 });
  }

  if (claim.kind === "saved") {
    return NextResponse.json(
      { message: "We've received your inquiry. Our team will contact you at the number you provided." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (claim.kind === "conflict") {
    return NextResponse.json(
      { error: "This submission changed. Please refresh the page and submit again." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (claim.kind === "processing") {
    return NextResponse.json(
      { error: "Your message is still being processed. Please wait and try again." },
      { status: 409, headers: { "Cache-Control": "no-store", "Retry-After": "2" } },
    );
  }

  let rateLimit: Awaited<ReturnType<typeof incrementRateLimit>>;
  try {
    rateLimit = await incrementRateLimit(database, clientIp, now);
  } catch (error) {
    await releaseSubmission(submissions, fields.submissionId, claim.leaseId);
    console.error("Contact inquiry rate limit check failed.", error);
    return NextResponse.json({ error: "Unable to submit your message right now. Please try again." }, { status: 503 });
  }

  if (rateLimit.count > RATE_LIMIT_MAX) {
    if (claim.isNew) {
      await releaseSubmission(submissions, fields.submissionId, claim.leaseId);
    } else {
      await submissions.updateOne(
        { _id: fields.submissionId, leaseId: claim.leaseId },
        { $set: { leaseUntil: now } },
      );
    }
    const retryAfter = Math.max(1, Math.ceil((rateLimit.windowEnd.getTime() - now.getTime()) / 1000));
    return NextResponse.json(
      { error: "Too many submissions. Please wait a few minutes and try again." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
    );
  }

  try {
    if (!(await hasShopifyMetaobjectWriteScope())) {
      throw new Error("The installed Shopify app is missing the write_metaobjects access scope.");
    }
    await createShopifyCustomerQuery({ ...fields, submittedAt: claim.submittedAt });
  } catch (error) {
    await expireSubmissionLease(submissions, fields.submissionId, claim.leaseId);
    console.error("Shopify customer inquiry creation failed.", error);
    return NextResponse.json(
      { error: "We couldn't save your message. Please try again." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const saved = await submissions.updateOne(
      { _id: fields.submissionId, state: "processing", leaseId: claim.leaseId },
      {
        $set: {
          state: "saved",
          leaseUntil: new Date(0),
          expiresAt: new Date(Date.now() + SUBMISSION_KEY_TTL_MS),
        },
      },
    );
    if (saved.matchedCount !== 1) {
      return NextResponse.json(
        { error: "Your message may still be processing. Please retry to confirm it was saved." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    console.error("Contact inquiry confirmation could not be stored.", error);
    return NextResponse.json(
      { error: "Your message may still be processing. Please retry to confirm it was saved." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { message: "We've received your inquiry. Our team will contact you at the number you provided." },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
