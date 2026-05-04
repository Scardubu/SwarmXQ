import type { NextConfig } from "next";

const API_URL = process.env.SWARMX_API_URL ?? "http://localhost:3001";

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
