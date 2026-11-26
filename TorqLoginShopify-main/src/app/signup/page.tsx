import Link from "next/link";
import { AuthBackLink } from "@/app/components/auth-back-link";
import { AuthForm } from "@/app/components/auth-form";
import { StoreHeader } from "@/app/components/store-chrome";

export default function SignupPage() {
  return (
    <>
      <StoreHeader hideProfile />
      <main className="signup-page">
        <div className="auth-card-container">
          <AuthBackLink />
          <section className="signup-card">
            <header className="signup-card-header">
              <h1>Signup</h1>
            </header>
            <AuthForm mode="signup" />
            <p className="signup-login-prompt">
              Already have an account? <Link href="/login">Sign in</Link>
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
