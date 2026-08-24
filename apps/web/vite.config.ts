import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only: forward same-origin /v1/* demo reads to a local Public BFF
    // (mirrors the production web-proxy behavior; no cross-origin fetch).
    proxy: {
      "/v1": {
        target: process.env.PUBLIC_BFF_URL ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@truemandate/read-model": path.resolve(
        __dirname,
        "../../packages/read-model/src/index.ts",
      ),
      "@truemandate/dashboard-ui": path.resolve(
        __dirname,
        "../../packages/dashboard-ui/src/index.ts",
      ),
      "@truemandate/observability-client": path.resolve(
        __dirname,
        "../../packages/observability-client/src/index.ts",
      ),
      "@truemandate/observability-service": path.resolve(
        __dirname,
        "../../services/observability-service/src/index.ts",
      ),
      // Browser-safe shims: the package indexes re-export node:fs modules.
      "@truemandate/safe-benchmark": path.resolve(
        __dirname,
        "./src/demo/safe-benchmark-browser.ts",
      ),
      "@truemandate/benchmark-runner": path.resolve(
        __dirname,
        "./src/demo/benchmark-runner-browser.ts",
      ),
      "@truemandate/protocol": path.resolve(
        __dirname,
        "../../packages/protocol/src/index.ts",
      ),
      "@truemandate/sdk-core": path.resolve(
        __dirname,
        "../../packages/sdk-core/src/index.ts",
      ),
      "@truemandate/crypto": path.resolve(
        __dirname,
        "../../packages/crypto/src/index.ts",
      ),
      "node:crypto": path.resolve(
        __dirname,
        "../../infrastructure/docker/node-crypto-shim.ts",
      ),
    },
  },
});
