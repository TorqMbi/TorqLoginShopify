import type { Metadata } from "next";
import Link from "next/link";
import { getCustomerHeaderCustomer, StoreHeader } from "@/app/components/store-chrome";
import { BearingCarousel } from "@/app/components/bearing-carousel";

export const metadata: Metadata = {
  title: "TORQ Bearings | Wholesale Bearings for Businesses",
  description: "Reliable bearings supplied by the carton to shops and businesses across Pakistan.",
};

const orderingSteps = [
  "Sign up to create your free account",
  "Add your shop details one time",
  "Browse bearings and add cartons to your cart",
  "Make payment and goods delivered within 3-4 days",
];

export default async function HomePage() {
  const customer = await getCustomerHeaderCustomer();
  const homeAction = customer.status === "no-details"
    ? { label: "Complete shop details", href: "/account/details" }
    : customer.status === "pending"
      ? { label: "View account status", href: "/dashboard" }
      : customer.status === "approved"
        ? { label: "Browse products", href: "/store" }
        : null;

  return (
    <div className="landing-home-shell">
      <StoreHeader customer={customer} hideHome hideContact hideEditDetails hideProfile />
      <main className="landing-page landing-home-page">
        <BearingCarousel />

        <div className="landing-content">
          <section className="landing-account-card" aria-labelledby="landing-title">
            <h1 id="landing-title">Sign up, Sign in, and Stay connected.</h1>
            {customer.status === "guest" ? (
              <div className="landing-actions">
                <Link className="landing-action-link" href="/signup">Sign up</Link>
                <Link className="landing-action-link" href="/login">Sign in</Link>
              </div>
            ) : homeAction ? (
              <div className="landing-actions">
                <Link className="landing-action-link" href={homeAction.href}>{homeAction.label}</Link>
              </div>
            ) : null}
          </section>

          <section className="landing-process" id="how-it-works" aria-labelledby="landing-process-title">
            <h2 id="landing-process-title">How ordering works</h2>
            <ol>
              {orderingSteps.map((step, index) => (
                <li key={step}>
                  <span aria-hidden="true">{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </div>
  );
}
