import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { StoreHeader } from "@/app/components/store-chrome";
import { getSession } from "@/lib/auth";
import { getDatabase, type CustomerDocument } from "@/lib/db";
import { AccountStatusSync } from "@/app/components/account-status-sync";

export const dynamic = "force-dynamic";

const statusMessage = {
  pending: "Your account is under review. Store access will be available once the review is complete.",
  blocked: "Your account is on hold. Please contact TORQ Bearings for help.",
  approved: "Welcome to TORQ Bearings.",
} as const;

const statusLabel = {
  pending: "Under review",
  blocked: "On hold",
  approved: "Approved",
} as const;

export default async function CustomerDashboard() {
  const session = await getSession();
  if (session?.role !== "customer" || !session.customerId) redirect("/signup");

  const database = await getDatabase();
  const customer = await database
    .collection<CustomerDocument>("customers")
    .findOne(
      { _id: new ObjectId(session.customerId) },
    { projection: { username: 1, shop_details: 1 } },
    );
  if (!customer) redirect("/signup");
  const status = customer.shop_details.status;
  if (!customer.shop_details.completedAt) redirect("/account/details");

  return (
    <>
      <StoreHeader customer={{
        status,
        name: customer.shop_details.contactPersonName?.trim() || customer.username,
      }} />
      <AccountStatusSync
        initialStatus={status}
        initialSyncVersion={customer.shop_details.syncVersion}
      />
      <main className="app-page">
        <section className="content-wrap">
          <div className="page-heading"><h1>Your account</h1><p>Your TORQ Bearings account status.</p></div>
          <div className="welcome-panel account-status-panel">
            <div className="account-status-topline">
              <div className="stat-label">Account status</div>
              <span className={`status status-${status}`}>{statusLabel[status]}</span>
            </div>
            <h2>
              {status === "approved"
                ? `Welcome, ${customer.username}.`
                : status === "pending"
                  ? "Your account is under review"
                  : "Your account needs attention"}
            </h2>
            <p>{statusMessage[status]}</p>
            {status === "approved" && (
              <Link className="button account-browse-button" href="/store">
                Browse Products
              </Link>
            )}
            {status === "pending" && (
              <Link className="button account-browse-button" href="/">
                Go to Home
              </Link>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
