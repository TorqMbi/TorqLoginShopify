import { ContactForm } from "@/app/components/contact-form";
import { StoreHeader } from "@/app/components/store-chrome";

export const metadata = {
  title: "Contact TORQ Bearings",
};

export default function ContactPage() {
  return (
    <>
      <StoreHeader />
      <main className="contact-page">
        <section className="contact-content">
          <h1>Contact</h1>
          <ContactForm />
        </section>
      </main>
    </>
  );
}
