import Link from "next/link";
import { getCustomerHeaderCustomer } from "@/lib/customer-header";
import { CustomerHeader } from "@/app/components/customer-header";
import type { CustomerHeaderCustomer } from "@/lib/customer-header";

export { getCustomerHeaderCustomer } from "@/lib/customer-header";

export async function StoreHeader({
  customer,
}: {
  customer?: CustomerHeaderCustomer;
} = {}) {
  const headerCustomer = customer ?? await getCustomerHeaderCustomer();
  return <CustomerHeader customer={headerCustomer} />;
}

export function StoreFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <section className="footer-brand">
          <div className="footer-brand-heading">
            <span className="footer-mark" aria-hidden="true">T</span>
            <strong>TorqBearings</strong>
          </div>
          <p>Wholesale bearings and industrial spare parts for shops, workshops and businesses across Pakistan.</p>
          <small>Operated by Aysha Bearing Industries.</small>
        </section>
        <section className="footer-contact">
          <h2>Get in touch</h2>
          <div>
            <a href="tel:+923224824413">+92 322 4824413</a>
            <a href="mailto:Ahmad.Ajam18@hotmail.com">Ahmad.Ajam18@hotmail.com</a>
            <Link href="/contact">Send a message</Link>
          </div>
        </section>
        <section className="footer-links">
          <h2>Helpful links</h2>
          <div>
            <Link href="/contact">Contact us</Link>
            <Link href="/shopify-policy/privacy-policy">Privacy Policy</Link>
            <Link href="/shopify-policy/shipping-policy">Shipping Policy</Link>
            <Link href="/shopify-policy/refund-policy">Refund Policy</Link>
            <Link href="/shopify-policy/terms-of-service">Terms &amp; Conditions</Link>
          </div>
        </section>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} TorqBearings</span>
        <Link href="/signup">Customer account</Link>
      </div>
    </footer>
  );
}
