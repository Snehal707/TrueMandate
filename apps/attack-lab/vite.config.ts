import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
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
      "@truemandate/safe-benchmark": path.resolve(
        __dirname,
        "../web/src/demo/safe-benchmark-browser.ts",
      ),
      "@truemandate/benchmark-runner": path.resolve(
        __dirname,
        "../web/src/demo/benchmark-runner-browser.ts",
      ),
      "@truemandate/sdk-core": path.resolve(
        __dirname,
        "../../packages/sdk-core/src/index.ts",
      ),
      "@truemandate/protocol": path.resolve(
        __dirname,
        "../../packages/protocol/src/index.ts",
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
