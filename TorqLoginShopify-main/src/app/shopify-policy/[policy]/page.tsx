import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreHeader } from "@/app/components/store-chrome";

type PolicySection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type Policy = {
  title: string;
  eyebrow: string;
  intro: string;
  sections: PolicySection[];
};

const policies: Record<string, Policy> = {
  "privacy-policy": {
    title: "Privacy Policy",
    eyebrow: "How we handle your information",
    intro: "This policy explains how TORQ Bearings collects, uses, and protects information when you use our website or communicate with our team.",
    sections: [
      {
        title: "Information we collect",
        paragraphs: ["We may collect the contact and shop details you provide, including your name, mobile number, shop name, address, city, province and account information."],
        bullets: ["Account and verification information", "Billing, delivery and order-related details", "Messages, calls or WhatsApp communications", "Basic website and security records"],
      },
      {
        title: "How we use information",
        bullets: ["To create and manage your customer account", "To verify your shop and approve catalog access", "To process, deliver and support your orders", "To prevent fraud and protect our website", "To respond to inquiries and send service updates"],
      },
      {
        title: "Sharing and security",
        paragraphs: ["We share information only when reasonably necessary to operate the business, complete an order, comply with legal requirements or protect TORQ Bearings and its customers. We use reasonable administrative and technical safeguards, but no online system can be guaranteed completely secure."],
      },
      {
        title: "Your choices",
        paragraphs: ["You may request correction or deletion of your account information by contacting us. Some information may need to be retained for tax, fraud prevention or legal-record purposes."],
      },
      {
        title: "Contact",
        paragraphs: ["For privacy requests, contact us at Ahmad.Ajam18@hotmail.com or by phone at +92 322 4824413."],
      },
    ],
  },
  "shipping-policy": {
    title: "Shipping Policy",
    eyebrow: "Delivery information",
    intro: "We arrange dependable nationwide delivery for approved wholesale customers. Availability, dispatch time and freight charges can vary by location and order volume.",
    sections: [
      {
        title: "Order processing",
        paragraphs: ["Orders are checked by our team after confirmation. We verify stock, quantity, customer information and the selected delivery city before dispatch."],
      },
      {
        title: "Delivery coverage",
        paragraphs: ["We can arrange delivery across Pakistan through our available transport partners. Customers may also coordinate pickup where it is offered for their area."],
      },
      {
        title: "Dispatch time",
        bullets: ["In-stock cartons are normally dispatched within 1–3 working days after order verification", "Special items or unavailable stock may require additional processing time", "Working days exclude Sundays and public holidays"],
      },
      {
        title: "Delivery charges",
        paragraphs: ["Freight charges are confirmed before dispatch and may depend on weight, carton quantity, destination and courier or transport charges. Any delivery charge is disclosed to the customer before the order is finalized."],
      },
      {
        title: "Receiving your order",
        paragraphs: ["Please inspect cartons for visible damage at the time of receipt and record any issue with the delivery agent. Report damaged or incorrect items promptly with your order number and clear photos."],
      },
    ],
  },
  "refund-policy": {
    title: "Refund Policy",
    eyebrow: "Returns and replacements",
    intro: "Because bearings are technical industrial products, returns are assessed carefully to protect product quality and ensure the correct item was supplied.",
    sections: [
      {
        title: "Before purchase",
        paragraphs: ["Please confirm the bearing size, type, quantity and application before placing an order. Our team can assist with product details, but the buyer is responsible for final compatibility."],
      },
      {
        title: "Eligible cases",
        bullets: ["Wrong item supplied by TORQ Bearings", "Visible damage or shortage reported within 48 hours of delivery", "Manufacturing defect supported by inspection and evidence"],
      },
      {
        title: "Items not eligible",
        bullets: ["Products opened, used or altered after delivery", "Incorrect size or specification selected by the customer", "Ordinary wear, improper installation or unsuitable application", "Items returned without prior approval"],
      },
      {
        title: "Replacement process",
        paragraphs: ["Contact us with the order number, item details and clear photographs within 48 hours of delivery. Our team may arrange an inspection or request the item for checking. Approved replacements or refunds are processed using the original payment method or as agreed with the customer."],
      },
      {
        title: "Return shipping",
        paragraphs: ["If the issue is confirmed as a supplier error or verified defect, TORQ Bearings may arrange or reimburse reasonable return shipping. For other approved returns, the customer may be responsible for return freight."],
      },
    ],
  },
  "terms-of-service": {
    title: "Terms & Conditions",
    eyebrow: "Website and purchase terms",
    intro: "By using this website or placing an order with TORQ Bearings, you agree to the terms below. These terms apply to account use, catalog access and wholesale purchases.",
    sections: [
      {
        title: "Customer accounts",
        paragraphs: ["Account holders must provide accurate shop and contact information and keep their login details secure. Accounts are subject to verification and approval. We may suspend access if information is false, misuse is suspected or an account creates risk."],
      },
      {
        title: "Pricing and availability",
        paragraphs: ["Wholesale prices may vary by city and availability. Product information and inventory are displayed for convenience and may change before an order is dispatched. We will confirm material changes with the customer before fulfillment."],
      },
      {
        title: "Orders",
        paragraphs: ["Placing an order does not by itself guarantee acceptance. An order is confirmed after verification of price, inventory, delivery information and payment terms. We may cancel or adjust an order when stock or information cannot be verified."],
      },
      {
        title: "Payment",
        paragraphs: ["Payment instructions and due dates are communicated during order confirmation unless a published checkout method states otherwise. Title and delivery risk transfer according to the agreed delivery terms."],
      },
      {
        title: "Acceptable use",
        bullets: ["Do not attempt unauthorized access or interfere with website operations", "Do not submit fraudulent orders or misleading account information", "Do not reuse or publish business information without authorization"],
      },
      {
        title: "Contact and changes",
        paragraphs: ["TORQ Bearings may update these terms when needed. Current terms apply from the effective date shown on this page. Questions or disputes should first be raised with us at Ahmad.Ajam18@hotmail.com or +92 322 4824413."],
      },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(policies).map((policy) => ({ policy }));
}

export function generateMetadata({ params }: { params: Promise<{ policy: string }> }): Promise<Metadata> {
  return params.then(({ policy }) => {
    const content = policies[policy];
    return content
      ? { title: `${content.title} | TORQ Bearings`, description: content.intro }
      : { title: "Policy | TORQ Bearings" };
  });
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ policy: string }>;
}) {
  const { policy } = await params;
  const content = policies[policy];
  if (!content) notFound();

  return (
    <>
      <StoreHeader />
      <main className="policy-page">
        <div className="policy-shell">
          <article className="policy-document">
            <header>
              <p>{content.eyebrow}</p>
              <h1>{content.title}</h1>
              <span>Effective: November 21, 2026</span>
              <div>{content.intro}</div>
            </header>
            {content.sections.map((section) => (
              <section key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && (
                  <ul>
                    {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>
                )}
              </section>
            ))}
            <footer className="policy-contact">
              <h2>Need assistance?</h2>
              <p>Our team is available to answer questions about our policies or your order.</p>
              <div>
                <a href="tel:+923224824413">+92 322 4824413</a>
                <a href="mailto:Ahmad.Ajam18@hotmail.com">Ahmad.Ajam18@hotmail.com</a>
              </div>
            </footer>
          </article>
        </div>
      </main>
    </>
  );
}
