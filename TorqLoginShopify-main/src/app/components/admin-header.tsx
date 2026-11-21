"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminLogoutButton } from "@/app/components/admin-logout-button";
import type { StaffIdentity } from "@/lib/staff-auth";

export function AdminHeader({ staff }: { staff: StaffIdentity }) {
  const pathname = usePathname();
  const verificationActive = pathname === "/admin" || pathname.startsWith("/admin/customers/");
  const pricingActive = pathname === "/admin/pricing" || pathname.startsWith("/admin/pricing/");
  const staffActive = pathname === "/admin/staff" || pathname.startsWith("/admin/staff/");

  return (
    <header className="topbar">
      <Link className="brand" href="/admin">
        <Image src="/torq-logo.jpg" width={52} height={52} alt="TORQ Bearings logo" unoptimized />
        <span className="brand-name">TORQ BEARINGS<span className="brand-sub">INDUSTRIES</span></span>
      </Link>
      <nav className="topbar-actions admin-header-actions" aria-label="Staff navigation">
        <Link className={verificationActive ? "active" : ""} href="/admin">Verification queue</Link>
        {staff.role === "admin" && <Link className={pricingActive ? "active" : ""} href="/admin/pricing">City pricing</Link>}
        {staff.role === "admin" && <Link className={staffActive ? "active" : ""} href="/admin/staff">Staff accounts</Link>}
        <span className="header-note">{staff.username} · {staff.role}</span>
        <AdminLogoutButton />
      </nav>
    </header>
  );
}
