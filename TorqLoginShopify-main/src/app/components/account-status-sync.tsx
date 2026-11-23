"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

type AccountStatus = "pending" | "approved" | "blocked";

type StatusResponse = {
  status: AccountStatus;
  syncVersion?: number;
  completed: boolean;
};

export function AccountStatusSync({
  initialStatus,
  initialSyncVersion = 0,
}: {
  initialStatus: AccountStatus;
  initialSyncVersion?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const observedStatus = useRef(initialStatus);
  const observedSyncVersion = useRef(initialSyncVersion);

  useEffect(() => {
    let disposed = false;

    async function syncStatus() {
      if (disposed || document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/account/status", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const result = await response.json() as StatusResponse;
        if (!response.ok) return;

        const statusChanged = result.status !== observedStatus.current;
        const versionChanged =
          typeof result.syncVersion === "number" &&
          result.syncVersion !== observedSyncVersion.current;
        if (!statusChanged && !versionChanged) return;

        observedStatus.current = result.status;
        observedSyncVersion.current =
          typeof result.syncVersion === "number"
            ? result.syncVersion
            : observedSyncVersion.current;

        if (!result.completed) {
          router.replace("/account/details");
          return;
        }
        if (pathname.startsWith("/store") && result.status !== "approved") {
          router.replace("/dashboard");
          return;
        }
        router.refresh();
      } catch {
        // The next interval or window-focus event retries the status check.
      }
    }

    void syncStatus();
    const interval = window.setInterval(() => void syncStatus(), 3000);
    window.addEventListener("focus", syncStatus);
    document.addEventListener("visibilitychange", syncStatus);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", syncStatus);
      document.removeEventListener("visibilitychange", syncStatus);
    };
  }, [pathname, router]);

  return null;
}
