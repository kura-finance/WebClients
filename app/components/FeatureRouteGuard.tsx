"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isRouteEnabled } from "@/config/features";

/**
 * Sends direct visits to a route whose feature is off (see config/features.ts)
 * back to /dashboard instead of rendering a page that cannot work.
 */
export default function FeatureRouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const enabled = isRouteEnabled(pathname);

  useEffect(() => {
    if (!enabled) router.replace("/dashboard");
  }, [enabled, router]);

  if (!enabled) return null;
  return <>{children}</>;
}
