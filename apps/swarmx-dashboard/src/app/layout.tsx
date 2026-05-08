import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const dashboardVersion =
  process.env.NEXT_PUBLIC_SWARMX_VERSION ??
  process.env.npm_package_version ??
  "0.1.0";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  preload: false,
  weight: ["400", "500", "600"],
});

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
  preload: false,
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
      className={`h-full ${jetbrainsMono.variable} ${geistSans.variable}`}
      suppressHydrationWarning
    >
      <body className="h-full bg-bg-base text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
