import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@swarmx/types": path.resolve(__dirname, "../../packages/swarmx-types/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    globals: false,
  },
});
