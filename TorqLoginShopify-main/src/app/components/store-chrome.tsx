import Image from "next/image";
import Link from "next/link";
import { getCustomerHeaderCustomer } from "@/lib/customer-header";
import { CustomerHeader } from "@/app/components/customer-header";
import type { CustomerHeaderCustomer } from "@/lib/customer-header";

export { getCustomerHeaderCustomer } from "@/lib/customer-header";

export async function StoreHeader({
  customer,
  hideHome = false,
  hideContact = false,
  hideEditDetails = false,
  hideProfile = false,
}: {
  customer?: CustomerHeaderCustomer;
  hideHome?: boolean;
  hideContact?: boolean;
  hideEditDetails?: boolean;
  hideProfile?: boolean;
} = {}) {
  const headerCustomer = customer ?? await getCustomerHeaderCustomer();
  return <CustomerHeader customer={headerCustomer} hideHome={hideHome} hideContact={hideContact} hideEditDetails={hideEditDetails} hideProfile={hideProfile} />;
}

const footerLinks = [
  { label: "Contact us", href: "/contact" },
  { label: "Privacy Policy", href: "/shopify-policy/privacy-policy" },
  { label: "Shipping Policy", href: "/shopify-policy/shipping-policy" },
  { label: "Refund Policy", href: "/shopify-policy/refund-policy" },
  { label: "Terms & Conditions", href: "/shopify-policy/terms-of-service" },
];

function FooterIcon({ icon }: { icon: "phone" | "mail" | "pin" }) {
  const paths = {
    phone: <path d="M6.6 3.5h2.6l1.4 4-2 1.3a11 11 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>,
  };
  return (
    <span className="footer-contact-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">{paths[icon]}</svg>
    </span>
  );
}

export function StoreFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <section className="footer-brand">
          <Link className="footer-brand-link" href="/" aria-label="TORQ Bearings home">
            <span className="footer-logo">
              <Image src="/torq-logo-badge.webp" width={48} height={48} alt="" unoptimized />
            </span>
            <span className="footer-wordmark">
              <strong>TORQ BEARINGS</strong>
              <small>Industries</small>
            </span>
          </Link>
          <p>Wholesale bearings and industrial spare parts for shops, workshops and businesses across Pakistan.</p>
          <small>Operated by Aysha Bearing Industries.</small>
        </section>
        <section className="footer-contact">
          <h2>Get in touch</h2>
          <ul>
            <li>
              <FooterIcon icon="phone" />
              <a href="tel:+923224824413">+92 322 4824413</a>
            </li>
            <li>
              <FooterIcon icon="mail" />
              <a href="mailto:Ahmad.Ajam18@hotmail.com">Ahmad.Ajam18@hotmail.com</a>
            </li>
            <li>
              <FooterIcon icon="pin" />
              <span>33-B, Street 1, Phase 5, DHA, Lahore, Pakistan</span>
            </li>
          </ul>
          <Link className="footer-message-button" href="/contact">
            Send a message
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </Link>
        </section>
        <nav className="footer-links" aria-label="Helpful links">
          <h2>Helpful links</h2>
          <ul>
            {footerLinks.map((link) => (
              <li key={link.href + link.label}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} TORQ Bearings. All rights reserved.</span>
        <Link href="/dashboard">Customer account</Link>
      </div>
    </footer>
  );
}
