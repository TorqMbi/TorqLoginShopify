import Link from "next/link";
import { AuthBackLink } from "@/app/components/auth-back-link";
import { OtpResetForm } from "@/app/components/otp-reset-form";
import { StoreFooter, StoreHeader } from "@/app/components/store-chrome";

export default function ForgotPasswordPage() {
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
