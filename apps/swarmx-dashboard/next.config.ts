import type { NextConfig } from "next";

// [V5.9-FIX-07] Default to IPv4 loopback to avoid localhost IPv6 resolution
// mismatches when the API is bound on 127.0.0.1.
const API_URL = process.env.SWARMX_API_URL ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  // Proxy all /api/* and /ws/* requests to the Fastify backend on Linux
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${API_URL}/ws/:path*`,
      },
    ];
  },
  // xterm.js and @xterm/* are browser-only — mark as external for server
  serverExternalPackages: [],
  // Transpile workspace package
  transpilePackages: ["@swarmx/types"],
};

export default nextConfig;
