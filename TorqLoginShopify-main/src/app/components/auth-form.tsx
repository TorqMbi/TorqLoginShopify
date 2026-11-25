"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type Props = {
  mode: "signup" | "login" | "admin";
};

export function AuthForm({ mode }: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isSignup = mode === "signup";
  const isLogin = mode === "login";
  const isAdmin = mode === "admin";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const nextFieldErrors: Record<string, string> = {};
    if (isLogin) {
      const mobileDigits = String(data.mobileNumber ?? "")
        .replace(/\D/g, "")
        .replace(/^92/, "")
        .replace(/^0/, "");
      if (!/^3\d{9}$/.test(mobileDigits)) {
        nextFieldErrors.mobileNumber = "Enter a valid mobile number.";
      }
      if (!String(data.password ?? "")) nextFieldErrors.password = "Enter your password.";
      if (Object.keys(nextFieldErrors).length) {
        setFieldErrors(nextFieldErrors);
        return;
      }
      data.mobileNumber = `+92${mobileDigits}`;
    }
    if (isSignup) {
      const mobileDigits = String(formData.get("mobileNumber") ?? "").replace(/\D/g, "").replace(/^92/, "").replace(/^0/, "");
      const password = String(formData.get("password") ?? "");
      const confirmPassword = String(formData.get("confirmPassword") ?? "");
      if (!/^3\d{9}$/.test(mobileDigits)) nextFieldErrors.mobileNumber = "Enter a valid mobile number.";
      const username = String(data.username ?? "").trim();
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
        nextFieldErrors.username = "Username must be 3–32 characters using letters, numbers, dots, underscores or hyphens.";
      }
      for (const [field, label] of [
        ["contactPersonName", "Contact person name"],
        ["shopName", "Shop name"],
        ["shopAddress", "Shop address"],
        ["detailedAddress", "Detailed address"],
        ["city", "City"],
        ["province", "Province"],
      ]) {
        if (!String(data[field] ?? "").trim()) nextFieldErrors[field] = `${label} is required.`;
      }
      const contactMobileDigits = String(data.contactMobileNumber ?? "")
        .replace(/\D/g, "")
        .replace(/^92/, "")
        .replace(/^0/, "");
      if (!/^3\d{9}$/.test(contactMobileDigits)) {
        nextFieldErrors.contactMobileNumber = "Enter a valid mobile number.";
      }
      const alternateMobileValue = String(data.alternateMobileNumber ?? "");
      const alternateMobileDigits = alternateMobileValue
        .replace(/\D/g, "")
        .replace(/^92/, "")
        .replace(/^0/, "");
      if (alternateMobileValue.trim() && !/^3\d{9}$/.test(alternateMobileDigits)) {
        nextFieldErrors.alternateMobileNumber = "Enter a valid alternate number.";
      }
      if (password.length < 12) nextFieldErrors.password = "Password must be at least 12 characters.";
      if (password !== confirmPassword) nextFieldErrors.confirmPassword = "Passwords do not match.";
      if (!formData.has("terms")) nextFieldErrors.terms = "You must agree to the Terms and Conditions.";
      if (Object.keys(nextFieldErrors).length) {
        setFieldErrors(nextFieldErrors);
        return;
      }
      data.mobileNumber = `+92${mobileDigits}`;
      data.contactMobileNumber = `+92${contactMobileDigits}`;
      data.alternateMobileNumber = alternateMobileValue.trim()
        ? `+92${alternateMobileDigits}`
        : "";
    }
    setFieldErrors({});
    setBusy(true);
    const endpoint = isSignup
      ? "/api/auth/signup"
      : isAdmin
        ? "/admin/api/login"
        : "/api/auth/login";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) {
        if (isAdmin && response.status === 401) {
          throw new Error("Username or password is incorrect.");
        }
        if (isLogin && response.status === 401) {
          throw new Error("Mobile number, username or password is incorrect.");
        }
        if ((isLogin || isAdmin) && response.status === 429) {
          throw new Error("Too many attempts. Please try again later.");
        }
        throw new Error(result.error ?? "Unable to complete this request.");
      }
      const customerRedirect = ["/store", "/account/details", "/dashboard"].includes(result.redirectTo)
        ? result.redirectTo
        : "/dashboard";
      window.location.assign(isAdmin ? "/admin" : customerRedirect);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete this request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`form-stack${isSignup ? " signup-form details-form" : isLogin ? " login-form" : ""}`}
      onSubmit={submit}
      noValidate={isSignup || isLogin}
    >
      {(isSignup || isLogin) && error && <div className="message message-error" role="alert">{error}</div>}
      {!isAdmin && !isLogin && (
        <div className="field">
          <label htmlFor="mobileNumber">Mobile Number</label>
          {isSignup ? (
            <input
              id="mobileNumber"
              name="mobileNumber"
              type="tel"
              autoComplete="tel"
              inputMode="numeric"
              maxLength={15}
              required
              placeholder="0300 1234567"
              aria-invalid={Boolean(fieldErrors.mobileNumber)}
              aria-describedby={fieldErrors.mobileNumber ? "mobileNumber-error" : undefined}
              onChange={() => setFieldErrors((current) => ({ ...current, mobileNumber: "" }))}
            />
          ) : (
            <>
              <input id="mobileNumber" name="mobileNumber" type="tel" autoComplete="tel" inputMode="tel" required placeholder="+92 300 1234567" />
              <span className="field-hint">Include your country code, for example +92.</span>
            </>
          )}
          {fieldErrors.mobileNumber && <span className="field-error" id="mobileNumber-error">{fieldErrors.mobileNumber}</span>}
        </div>
      )}
      {isLogin && (
        <div className="field">
          <label htmlFor="loginIdentifier">Mobile number</label>
          <input
            id="loginIdentifier"
            name="mobileNumber"
            type="tel"
            autoComplete="tel"
            inputMode="numeric"
            maxLength={15}
            required
            placeholder="0300 1234567"
            aria-invalid={Boolean(fieldErrors.mobileNumber)}
            aria-describedby={fieldErrors.mobileNumber ? "loginIdentifier-error" : undefined}
            onChange={() => setFieldErrors((current) => ({ ...current, mobileNumber: "" }))}
          />
          {fieldErrors.mobileNumber && <span className="field-error" id="loginIdentifier-error">{fieldErrors.mobileNumber}</span>}
        </div>
      )}
      {isSignup && (
        <>
          <div className="field">
            <label htmlFor="contactPersonName">Contact person name <span className="details-required">*</span></label>
            <input id="contactPersonName" name="contactPersonName" autoComplete="name" maxLength={2000} required aria-invalid={Boolean(fieldErrors.contactPersonName)} onChange={() => setFieldErrors((current) => ({ ...current, contactPersonName: "" }))} />
            {fieldErrors.contactPersonName && <span className="field-error">{fieldErrors.contactPersonName}</span>}
          </div>
          <div className="field">
            <label htmlFor="shopName">Shop name <span className="details-required">*</span></label>
            <input id="shopName" name="shopName" maxLength={2000} required aria-invalid={Boolean(fieldErrors.shopName)} onChange={() => setFieldErrors((current) => ({ ...current, shopName: "" }))} />
            {fieldErrors.shopName && <span className="field-error">{fieldErrors.shopName}</span>}
          </div>
          <div className="field">
            <label htmlFor="contactMobileNumber">Mobile / WhatsApp number <span className="details-required">*</span></label>
            <div className={`signup-mobile-box${fieldErrors.contactMobileNumber ? " has-error" : ""}`}>
              <span className="signup-mobile-prefix" aria-hidden="true">+92</span>
              <input id="contactMobileNumber" name="contactMobileNumber" type="tel" autoComplete="tel" inputMode="numeric" maxLength={15} required placeholder="3XX XXXXXXX" aria-invalid={Boolean(fieldErrors.contactMobileNumber)} onChange={() => setFieldErrors((current) => ({ ...current, contactMobileNumber: "" }))} />
            </div>
            <span className="field-hint">We will contact you on this number.</span>
            {fieldErrors.contactMobileNumber && <span className="field-error">{fieldErrors.contactMobileNumber}</span>}
          </div>
          <div className="field">
            <label htmlFor="alternateMobileNumber">Alternate number <span className="details-optional">(optional)</span></label>
            <input id="alternateMobileNumber" name="alternateMobileNumber" type="tel" autoComplete="tel" inputMode="numeric" maxLength={15} placeholder="0300 1234567" aria-invalid={Boolean(fieldErrors.alternateMobileNumber)} onChange={() => setFieldErrors((current) => ({ ...current, alternateMobileNumber: "" }))} />
            {fieldErrors.alternateMobileNumber && <span className="field-error">{fieldErrors.alternateMobileNumber}</span>}
          </div>
          <div className="field">
            <label htmlFor="shopAddress">Shop address <span className="details-required">*</span></label>
            <input id="shopAddress" name="shopAddress" maxLength={2000} required placeholder="Shop number, building or market" aria-invalid={Boolean(fieldErrors.shopAddress)} onChange={() => setFieldErrors((current) => ({ ...current, shopAddress: "" }))} />
            {fieldErrors.shopAddress && <span className="field-error">{fieldErrors.shopAddress}</span>}
          </div>
          <div className="field">
            <label htmlFor="detailedAddress">Detailed address <span className="details-required">*</span></label>
            <textarea id="detailedAddress" name="detailedAddress" maxLength={2000} required rows={3} placeholder="Street, area and nearby landmark" aria-invalid={Boolean(fieldErrors.detailedAddress)} onChange={() => setFieldErrors((current) => ({ ...current, detailedAddress: "" }))} />
            {fieldErrors.detailedAddress && <span className="field-error">{fieldErrors.detailedAddress}</span>}
          </div>
          <div className="field">
            <label htmlFor="city">City <span className="details-required">*</span></label>
            <input id="city" name="city" maxLength={2000} required placeholder="Lahore" aria-invalid={Boolean(fieldErrors.city)} onChange={() => setFieldErrors((current) => ({ ...current, city: "" }))} />
            {fieldErrors.city && <span className="field-error">{fieldErrors.city}</span>}
          </div>
          <div className="field">
            <label htmlFor="province">Province <span className="details-required">*</span></label>
            <div className="province-select-wrap">
              <select id="province" name="province" required defaultValue="" aria-invalid={Boolean(fieldErrors.province)} onChange={() => setFieldErrors((current) => ({ ...current, province: "" }))}>
                <option value="" disabled>Select province</option>
                <option>Punjab</option>
                <option>Sindh</option>
                <option>Khyber Pakhtunkhwa</option>
                <option>Balochistan</option>
                <option>Islamabad Capital Territory</option>
                <option>Gilgit-Baltistan</option>
                <option>Azad Jammu and Kashmir</option>
              </select>
            </div>
            {fieldErrors.province && <span className="field-error">{fieldErrors.province}</span>}
          </div>
        </>
      )}
      {isSignup && (
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            minLength={3}
            maxLength={32}
            required
            placeholder="Choose a username"
            aria-invalid={Boolean(fieldErrors.username)}
            aria-describedby={fieldErrors.username ? "username-error" : undefined}
            onChange={() => setFieldErrors((current) => ({ ...current, username: "" }))}
          />
          {fieldErrors.username && <span className="field-error" id="username-error">{fieldErrors.username}</span>}
        </div>
      )}
      {isAdmin && (
        <div className="field">
          <label htmlFor="username">Staff username</label>
          <input id="username" name="username" autoComplete="username" required />
        </div>
      )}
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className={isSignup || isLogin ? "signup-password-box" : undefined}>
          <input
            id="password"
            name="password"
            type={(isSignup || isLogin) && showPassword ? "text" : "password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={isSignup ? 12 : undefined}
            required
            placeholder="Enter your password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={
              isSignup
                ? `${fieldErrors.password ? "password-error " : ""}password-hint`
                : fieldErrors.password
                  ? "password-error"
                  : undefined
            }
            onChange={() => setFieldErrors((current) => ({ ...current, password: "" }))}
          />
          {(isSignup || isLogin) && (
            <button type="button" className="signup-password-toggle" onClick={() => setShowPassword((shown) => !shown)}>
              {showPassword ? "Hide" : "Show"}
            </button>
          )}
        </div>
        {isSignup && <span className="field-hint" id="password-hint">At least 12 characters.</span>}
        {isLogin && (
          <Link className="login-forgot-link" href="/forgot-password">
            Forgot password?
          </Link>
        )}
        {fieldErrors.password && <span className="field-error" id="password-error">{fieldErrors.password}</span>}
      </div>
      {isSignup && (
        <div className="field">
          <label htmlFor="confirmPassword">Confirm Password</label>
          <div className="signup-password-box">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={12}
              required
              placeholder="Re-enter your password"
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={fieldErrors.confirmPassword ? "confirmPassword-error" : undefined}
              onChange={() => setFieldErrors((current) => ({ ...current, confirmPassword: "" }))}
            />
            <button type="button" className="signup-password-toggle" onClick={() => setShowConfirmPassword((shown) => !shown)}>
              {showConfirmPassword ? "Hide" : "Show"}
            </button>
          </div>
          {fieldErrors.confirmPassword && <span className="field-error" id="confirmPassword-error">{fieldErrors.confirmPassword}</span>}
        </div>
      )}
      {isSignup && (
        <div className="signup-terms-field">
          <label className="signup-terms-label">
            <input
              type="checkbox"
              name="terms"
              required
              aria-invalid={Boolean(fieldErrors.terms)}
              aria-describedby={fieldErrors.terms ? "terms-error" : undefined}
              onChange={() => setFieldErrors((current) => ({ ...current, terms: "" }))}
            />
            <span>
              I agree to the{" "}
              <a href="/shopify-policy/terms-of-service">
                Terms and Conditions
              </a>
            </span>
          </label>
          {fieldErrors.terms && <span className="field-error" id="terms-error">{fieldErrors.terms}</span>}
        </div>
      )}
      {!isSignup && !isLogin && error && <div className="message message-error" role="alert">{error}</div>}
      <button className="button" type="submit" disabled={busy}>
        {busy ? (
          isSignup
            ? <><span className="signup-spinner" aria-hidden="true" />Creating account</>
            : isLogin
              ? <><span className="signup-spinner" aria-hidden="true" />Signing in</>
              : "Please wait…"
        ) : isSignup ? "Create account" : "Sign in"}
      </button>
      {isAdmin && <div className="admin-foot">Restricted to authorized TORQ Bearings administrators.</div>}
    </form>
  );
}
