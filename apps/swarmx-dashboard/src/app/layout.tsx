import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

const dashboardVersion =
  process.env.NEXT_PUBLIC_SWARMX_VERSION ??
  process.env.npm_package_version ??
  "0.1.0";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

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
    <html
      lang="en"
      className={`h-full ${jetbrainsMono.variable} ${GeistSans.variable}`}
      suppressHydrationWarning
    >
      <body className="h-full bg-bg-base text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
