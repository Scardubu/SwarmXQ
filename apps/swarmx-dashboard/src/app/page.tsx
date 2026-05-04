import { redirect } from "next/navigation";

/**
 * Root entry point — defers to the (dashboard) route group.
 * If this file is served instead of (dashboard)/page.tsx, redirect to /agents.
 */
export default function RootPage() {
  redirect("/agents");
}
