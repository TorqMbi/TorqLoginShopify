"use client";

import { useRef, useState, type FormEvent } from "react";

type SubmissionStatus =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | null;

export function ContactForm() {
  const submissionId = useRef("");
  const previousPayload = useRef<string | null>(null);
  const [status, setStatus] = useState<SubmissionStatus>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const message = String(formData.get("message") ?? "").trim();
    const website = String(formData.get("website") ?? "");
    const payload = JSON.stringify([name, phone, message]);
    if (previousPayload.current !== null && previousPayload.current !== payload) {
      submissionId.current = "";
    }
    submissionId.current ||= crypto.randomUUID();
    previousPayload.current = payload;
    setIsSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: submissionId.current,
          name,
          phone,
          message,
          website,
        }),
      });
      const result: unknown = await response.json();
      const responseMessage =
        result && typeof result === "object" && "message" in result && typeof result.message === "string"
          ? result.message
          : null;
      const responseError =
        result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error
          : null;

      if (!response.ok) {
        setStatus({ kind: "error", message: responseError ?? "We couldn't save your message. Please try again." });
        return;
      }

      setStatus({
        kind: "success",
        message:
          responseMessage ??
          "We've received your inquiry. Our team will contact you at the number you provided.",
      });
      form.reset();
      submissionId.current = "";
      previousPayload.current = null;
    } catch {
      setStatus({ kind: "error", message: "We couldn't save your message. Please check your connection and retry." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <label htmlFor="contact-name">Name<span>*</span></label>
      <input id="contact-name" name="name" autoComplete="name" required />

      <label htmlFor="contact-phone">Mobile / WhatsApp number<span>*</span></label>
      <input
        id="contact-phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="+92 300 1234567"
        required
      />

      <label htmlFor="contact-message">Message<span>*</span></label>
      <textarea id="contact-message" name="message" rows={6} required />

      <div className="contact-form-trap" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending..." : status?.kind === "error" ? "Retry" : "Send message"}
      </button>
      {status && (
        <p className={`contact-form-status contact-form-status-${status.kind}`} role="status" aria-live="polite">
          {status.message}
        </p>
      )}
    </form>
  );
}
