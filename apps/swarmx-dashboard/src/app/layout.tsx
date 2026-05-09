import type { Metadata } from "next";
import "./globals.css";

const dashboardVersion =
  process.env.NEXT_PUBLIC_SWARMX_VERSION ??
  process.env.npm_package_version ??
  "0.1.0";

export const metadata: Metadata = {
  title: {
    default: "SwarmX Operator Console",
    template: "%s | SwarmX Operator Console",
  },
  description:
    `SwarmX ${dashboardVersion} operator console for live fleet telemetry, workflow control, logs, and Linux runtime diagnostics.`,
  keywords: ["swarm", "agents", "orchestration", "telemetry", "LLM"],
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    // [V6.1-FIX-13] Use CSS font fallbacks instead of network-fetched
    // next/font Google assets so production builds stay deterministic offline.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full bg-bg-base text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
