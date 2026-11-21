"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Step = "number" | "code" | "done";

const PASSWORD_MIN_LENGTH = 12;

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 429) throw new Error(result.error ?? "Too many attempts. Please try again later.");
  if (!response.ok) throw new Error(result.error ?? "Something went wrong. Please try again.");
  return result as { message?: string; resendAfterSeconds?: number };
}

export function OtpResetForm() {
  const [step, setStep] = useState<Step>("number");
  const [mobileNumber, setMobileNumber] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [staffMessage, setStaffMessage] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function clearFieldError(name: string) {
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  async function sendCode(number: string) {
    setError("");
    setBusy(true);
    try {
      const result = await postJson("/api/auth/forgot-password/code", { mobileNumber: number });
      setSentMessage(result.message ?? "If this number is registered, we've sent a 6-digit code.");
      setCooldown(result.resendAfterSeconds ?? 60);
      setStep("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send a code right now.");
    } finally {
      setBusy(false);
    }
  }

  async function submitNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = String(new FormData(event.currentTarget).get("mobileNumber") ?? "").trim();
    if (!number) {
      setFieldErrors({ mobileNumber: "Enter your mobile number." });
      return;
    }
    setFieldErrors({});
    setMobileNumber(number);
    await sendCode(number);
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("code") ?? "").replace(/\s/g, "");
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const nextErrors: Record<string, string> = {};
    if (!/^\d{6}$/.test(code)) nextErrors.code = "Enter the 6-digit code.";
    if (password.length < PASSWORD_MIN_LENGTH) nextErrors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (password !== confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await postJson("/api/auth/reset-password/code", { mobileNumber, code, password, confirmPassword });
      setStep("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update your password right now.");
    } finally {
      setBusy(false);
    }
  }

  async function askStaff() {
    setError("");
    setBusy(true);
    try {
      const result = await postJson("/api/auth/forgot-password", { mobileNumber });
      setStaffMessage(result.message ?? "Your request has been sent to our team.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send your request right now.");
    } finally {
      setBusy(false);
    }
  }

  function changeNumber() {
    setStep("number");
    setError("");
    setFieldErrors({});
    setStaffMessage("");
    setCooldown(0);
  }

  if (step === "done") {
    return (
      <div className="form-stack login-form">
        <div className="message message-success" role="status">
          Your password has been updated, and any device that was signed in has been signed out.
        </div>
        <Link className="button" href="/login">Sign in</Link>
      </div>
    );
  }

  if (step === "number") {
    return (
      <form className="form-stack login-form" onSubmit={submitNumber} noValidate>
        {error && <div className="message message-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="resetMobileNumber">Mobile number</label>
          <input
            id="resetMobileNumber"
            name="mobileNumber"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            defaultValue={mobileNumber}
            placeholder="+92 300 1234567"
            aria-invalid={Boolean(fieldErrors.mobileNumber)}
            aria-describedby={fieldErrors.mobileNumber ? "resetMobileNumber-error" : undefined}
            onChange={() => clearFieldError("mobileNumber")}
          />
          {fieldErrors.mobileNumber && <span className="field-error" id="resetMobileNumber-error">{fieldErrors.mobileNumber}</span>}
        </div>
        <button className="button" type="submit" disabled={busy}>
          {busy ? <><span className="signup-spinner" aria-hidden="true" />Sending code</> : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form className="form-stack login-form" onSubmit={submitCode} noValidate>
      <div className="message message-success" role="status">{sentMessage}</div>
      {error && <div className="message message-error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="resetCode">6-digit code</label>
        <input
          id="resetCode"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          placeholder="123456"
          aria-invalid={Boolean(fieldErrors.code)}
          aria-describedby={fieldErrors.code ? "resetCode-error" : undefined}
          onChange={() => clearFieldError("code")}
        />
        {fieldErrors.code && <span className="field-error" id="resetCode-error">{fieldErrors.code}</span>}
      </div>
      <div className="field">
        <label htmlFor="resetPassword">New password</label>
        <div className="signup-password-box">
          <input
            id="resetPassword"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={72}
            required
            placeholder="Enter a new password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={`${fieldErrors.password ? "resetPassword-error " : ""}resetPassword-hint`}
            onChange={() => clearFieldError("password")}
          />
          <button type="button" className="signup-password-toggle" onClick={() => setShowPassword((shown) => !shown)}>
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <span className="field-hint" id="resetPassword-hint">At least {PASSWORD_MIN_LENGTH} characters.</span>
        {fieldErrors.password && <span className="field-error" id="resetPassword-error">{fieldErrors.password}</span>}
      </div>
      <div className="field">
        <label htmlFor="resetConfirmPassword">Confirm new password</label>
        <div className="signup-password-box">
          <input
            id="resetConfirmPassword"
            name="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            maxLength={72}
            required
            placeholder="Re-enter your new password"
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            aria-describedby={fieldErrors.confirmPassword ? "resetConfirmPassword-error" : undefined}
            onChange={() => clearFieldError("confirmPassword")}
          />
        </div>
        {fieldErrors.confirmPassword && <span className="field-error" id="resetConfirmPassword-error">{fieldErrors.confirmPassword}</span>}
      </div>
      <button className="button" type="submit" disabled={busy}>
        {busy ? <><span className="signup-spinner" aria-hidden="true" />Updating password</> : "Reset password"}
      </button>
      <div className="otp-reset-actions">
        <button type="button" className="otp-text-button" disabled={busy || cooldown > 0} onClick={() => void sendCode(mobileNumber)}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
        <button type="button" className="otp-text-button" disabled={busy} onClick={changeNumber}>
          Use a different number
        </button>
      </div>
      {staffMessage ? (
        <div className="message message-success" role="status">{staffMessage}</div>
      ) : (
        <p className="otp-reset-help">
          Didn&apos;t get a code?{" "}
          <button type="button" className="otp-text-button" disabled={busy} onClick={() => void askStaff()}>
            Ask our team for a reset link
          </button>
        </p>
      )}
    </form>
  );
}
