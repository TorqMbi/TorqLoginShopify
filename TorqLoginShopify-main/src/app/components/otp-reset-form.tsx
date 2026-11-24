"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type Step = "identity" | "password" | "done";

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
  const [step, setStep] = useState<Step>("identity");
  const [mobileNumber, setMobileNumber] = useState("");
  const [shopName, setShopName] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function clearFieldError(name: string) {
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  async function submitIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const number = String(formData.get("mobileNumber") ?? "").trim();
    const shop = String(formData.get("shopName") ?? "").trim();
    const location = String(formData.get("city") ?? "").trim();
    const nextErrors: Record<string, string> = {};
    if (!number) nextErrors.mobileNumber = "Enter your mobile number.";
    if (!shop) nextErrors.shopName = "Enter your shop name.";
    if (!location) nextErrors.city = "Enter your city.";
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await postJson("/api/auth/forgot-password", {
        mobileNumber: number,
        shopName: shop,
        city: location,
      });
      setMobileNumber(number);
      setShopName(shop);
      setCity(location);
      setStep("password");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify your account.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const nextErrors: Record<string, string> = {};
    if (password.length < PASSWORD_MIN_LENGTH) nextErrors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (password !== confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await postJson("/api/auth/reset-password", {
        mobileNumber,
        shopName,
        city,
        password,
        confirmPassword,
      });
      setStep("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update your password right now.");
    } finally {
      setBusy(false);
    }
  }

  function changeIdentity() {
    setStep("identity");
    setError("");
    setFieldErrors({});
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

  if (step === "identity") {
    return (
      <form className="form-stack login-form" onSubmit={submitIdentity} noValidate>
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
        <div className="field">
          <label htmlFor="resetShopName">Shop name</label>
          <input
            id="resetShopName"
            name="shopName"
            type="text"
            autoComplete="organization"
            required
            defaultValue={shopName}
            placeholder="Al-Madina Traders"
            aria-invalid={Boolean(fieldErrors.shopName)}
            aria-describedby={fieldErrors.shopName ? "resetShopName-error" : undefined}
            onChange={() => clearFieldError("shopName")}
          />
          {fieldErrors.shopName && <span className="field-error" id="resetShopName-error">{fieldErrors.shopName}</span>}
        </div>
        <div className="field">
          <label htmlFor="resetCity">City</label>
          <input
            id="resetCity"
            name="city"
            type="text"
            autoComplete="address-level2"
            required
            defaultValue={city}
            placeholder="Lahore"
            aria-invalid={Boolean(fieldErrors.city)}
            aria-describedby={fieldErrors.city ? "resetCity-error" : undefined}
            onChange={() => clearFieldError("city")}
          />
          {fieldErrors.city && <span className="field-error" id="resetCity-error">{fieldErrors.city}</span>}
        </div>
        <button className="button" type="submit" disabled={busy}>
          {busy ? <><span className="signup-spinner" aria-hidden="true" />Verifying</> : "Verify account"}
        </button>
      </form>
    );
  }

  return (
    <form className="form-stack login-form" onSubmit={submitPassword} noValidate>
      <div className="message message-success" role="status">Account verified. Enter your new password.</div>
      {error && <div className="message message-error" role="alert">{error}</div>}
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
        <button type="button" className="otp-text-button" disabled={busy} onClick={changeIdentity}>
          Change account details
        </button>
      </div>
    </form>
  );
}
