import Link from "next/link";
import { AuthBackLink } from "@/app/components/auth-back-link";
import { ForgotPasswordForm } from "@/app/components/forgot-password-form";
import { OtpResetForm } from "@/app/components/otp-reset-form";
import { StoreFooter, StoreHeader } from "@/app/components/store-chrome";
import { isOtpResetEnabled } from "@/lib/otp-delivery";

// Read the OTP settings on every request, not once at build time.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (isOtpResetEnabled()) {
    return (
      <>
        <StoreHeader />
        <main className="signup-page">
          <div className="auth-card-container">
            <AuthBackLink />
            <section className="signup-card">
              <header className="signup-card-header">
                <h1>Reset your password</h1>
                <p>Enter your registered mobile number. We&apos;ll send you a 6-digit code to set a new password.</p>
              </header>
              <OtpResetForm />
              <p className="signup-login-prompt">
                Remembered it? <Link href="/login">Back to sign in</Link>
              </p>
            </section>
          </div>
        </main>
        <StoreFooter />
      </>
    );
  }

  return (
    <>
      <StoreHeader />
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-main">
            <span className="form-eyebrow">Account support</span>
            <h1>Forgot password?</h1>
            <p className="auth-intro">Enter the mobile number registered to your account. An admin will verify your request and send the secure reset link via WhatsApp.</p>
            <ForgotPasswordForm />
            <div className="inline-links"><Link href="/login">Back to sign in</Link></div>
          </div>
        </section>
      </main>
      <StoreFooter />
    </>
  );
}
