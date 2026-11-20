import { redirect } from "next/navigation";
import { AdminHeader } from "@/app/components/admin-header";
import { CityPricingManager } from "@/app/components/city-pricing-manager";
import { getStaffSession } from "@/lib/staff-auth";

export default async function CityPricingPage() {
  const staff = await getStaffSession();
  if (!staff) redirect("/admin/login");
  if (staff.role !== "admin") redirect("/admin");

  return (
    <main className="app-page">
      <AdminHeader staff={staff} />
      <section className="content-wrap">
        <div className="page-heading"><h1>City pricing</h1><p>Set the prices shops see for their city. Changes apply to new orders straight away.</p></div>
        <CityPricingManager />
      </section>
    </main>
  );
}
