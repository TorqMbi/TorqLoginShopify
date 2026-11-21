import Link from "next/link";
import { AuthBackLink } from "@/app/components/auth-back-link";
import { AuthForm } from "@/app/components/auth-form";
import { StoreFooter, StoreHeader } from "@/app/components/store-chrome";

export default function SignupPage() {
  return (
    <>
      <StoreHeader />
      <main className="signup-page">
        <div className="auth-card-container">
          <AuthBackLink />
          <section className="signup-card">
            <header className="signup-card-header">
              <h1>Create your TORQ account</h1>
              <p>Create your account and add your shop details. Required information helps our team review your account.</p>
            </header>
            <AuthForm mode="signup" />
            <p className="signup-login-prompt">
              Already have an account? <Link href="/login">Sign in</Link>
            </p>
          </section>
        </div>
      </main>
      <StoreFooter />
    </>
  );
}
