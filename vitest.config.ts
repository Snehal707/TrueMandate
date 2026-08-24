import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@truemandate/evidence-service/internal-routes": path.join(root, "services/evidence-service/src/internal-routes.ts"),
      "@truemandate/resolution-service/outcome-internal-routes": path.join(root, "services/resolution-service/src/outcome-internal-routes.ts"),
      "@truemandate/resolution-service/resolution-read-routes": path.join(root, "services/resolution-service/src/resolution-read-routes.ts"),

      "@truemandate/protocol": path.join(root, "packages/protocol/src/index.ts"),
      "@truemandate/schemas": path.join(root, "packages/schemas/src/index.ts"),
      "@truemandate/crypto": path.join(root, "packages/crypto/src/index.ts"),
      "@truemandate/authority": path.join(root, "packages/authority/src/index.ts"),
      "@truemandate/provenance": path.join(root, "packages/provenance/src/index.ts"),
      "@truemandate/model": path.join(root, "packages/model/src/index.ts"),
      "@truemandate/semantic-grounding": path.join(
        root,
        "packages/semantic-grounding/src/index.ts",
      ),
      "@truemandate/semantic-readiness": path.join(
        root,
        "packages/semantic-readiness/src/index.ts",
      ),
      "@truemandate/delegation": path.join(root, "packages/delegation/src/index.ts"),
      "@truemandate/guardian-core": path.join(root, "packages/guardian-core/src/index.ts"),
      "@truemandate/tool-registry": path.join(root, "packages/tool-registry/src/index.ts"),
      "@truemandate/side-effect-ledger": path.join(
        root,
        "packages/side-effect-ledger/src/index.ts",
      ),
      "@truemandate/outcome-core": path.join(root, "packages/outcome-core/src/index.ts"),
      "@truemandate/evidence-service": path.join(
        root,
        "services/evidence-service/src/index.ts",
      ),
      "@truemandate/outcome-service": path.join(
        root,
        "services/outcome-service/src/index.ts",
      ),
      "@truemandate/outcome-verifier": path.join(
        root,
        "agents/outcome-verifier/src/index.ts",
      ),
      "@truemandate/resolution-core": path.join(
        root,
        "packages/resolution-core/src/index.ts",
      ),
      "@truemandate/resolution-service": path.join(
        root,
        "services/resolution-service/src/index.ts",
      ),
      "@truemandate/resolution-agent": path.join(
        root,
        "agents/resolution-agent/src/index.ts",
      ),
      "@truemandate/read-model": path.join(root, "packages/read-model/src/index.ts"),
      "@truemandate/observability-client": path.join(
        root,
        "packages/observability-client/src/index.ts",
      ),
      "@truemandate/architecture": path.join(
        root,
        "packages/architecture/src/index.ts",
      ),
      "@truemandate/observability-service": path.join(
        root,
        "services/observability-service/src/index.ts",
      ),
      "@truemandate/dashboard-ui": path.join(
        root,
        "packages/dashboard-ui/src/index.ts",
      ),
      "@truemandate/safe-benchmark": path.join(
        root,
        "packages/safe-benchmark/src/index.ts",
      ),
      "@truemandate/cloud-firestore": path.join(
        root,
        "packages/cloud-firestore/src/index.ts",
      ),
      "@truemandate/analytics-bigquery": path.join(
        root,
        "packages/analytics-bigquery/src/index.ts",
      ),
      "@truemandate/analytics-query": path.join(
        root,
        "packages/analytics-query/src/index.ts",
      ),
      "@truemandate/analytics-scoring": path.join(
        root,
        "packages/analytics-scoring/src/index.ts",
      ),
      "@truemandate/preference-core": path.join(
        root,
        "packages/preference-core/src/index.ts",
      ),
      "@truemandate/workflow-rule-core": path.join(
        root,
        "packages/workflow-rule-core/src/index.ts",
      ),

      "@truemandate/analytics-export-service": path.join(
        root,
        "services/analytics-export-service/src/index.ts",
      ),
      "@truemandate/analytics-query-service": path.join(
        root,
        "services/analytics-query-service/src/index.ts",
      ),
      "@truemandate/analytics-query-service/analytics-query-routes": path.join(
        root,
        "services/analytics-query-service/src/analytics-query-routes.ts",
      ),
      "@truemandate/cloud-pubsub": path.join(
        root,
        "packages/cloud-pubsub/src/index.ts",
      ),
      "@truemandate/cloud-security": path.join(
        root,
        "packages/cloud-security/src/index.ts",
      ),
      "@truemandate/cloud-runtime": path.join(
        root,
        "packages/cloud-runtime/src/index.ts",
      ),
      "@truemandate/observability/workflow-stage": path.join(
        root,
        "packages/observability/src/workflow-stage.ts",
      ),
      "@truemandate/observability/structured-log": path.join(
        root,
        "packages/observability/src/structured-log.ts",
      ),
      "@truemandate/observability/propagation": path.join(
        root,
        "packages/observability/src/propagation.ts",
      ),
      "@truemandate/observability": path.join(
        root,
        "packages/observability/src/index.ts",
      ),
      "@truemandate/sdk-adk": path.join(root, "packages/sdk-adk/src/index.ts"),
      "@truemandate/sdk-core": path.join(root, "packages/sdk-core/src/index.ts"),
      "@truemandate/sdk-agent": path.join(root, "packages/sdk-agent/src/index.ts"),
      "@truemandate/public-api": path.join(
        root,
        "packages/public-api/src/index.ts",
      ),
      "@truemandate/benchmark-runner": path.join(
        root,
        "services/benchmark-runner/src/index.ts",
      ),
      "@truemandate/intent-service": path.join(root, "services/intent-service/src/index.ts"),
      "@truemandate/provenance-service": path.join(
        root,
        "services/provenance-service/src/index.ts",
      ),
      "@truemandate/authority-service": path.join(
        root,
        "services/authority-service/src/index.ts",
      ),
      "@truemandate/learning-service": path.join(
        root,
        "services/learning-service/src/index.ts",
      ),
      "@truemandate/learning-service/learning-routes": path.join(
        root,
        "services/learning-service/src/learning-routes.ts",
      ),
      "@truemandate/gateway-service": path.join(root, "services/gateway-service/src/index.ts"),
      "@truemandate/intent-compiler": path.join(root, "agents/intent-compiler/src/index.ts"),
      "@truemandate/intent-verifier": path.join(root, "agents/intent-verifier/src/index.ts"),
      "@truemandate/plan-verifier": path.join(root, "agents/plan-verifier/src/index.ts"),
      "@truemandate/planner": path.join(root, "agents/planner/src/index.ts"),
      "@truemandate/fidelity-judge": path.join(root, "agents/fidelity-judge/src/index.ts"),
      "@truemandate/contradiction-judge": path.join(
        root,
        "agents/contradiction-judge/src/index.ts",
      ),
      "@truemandate/devils-advocate": path.join(root, "agents/devils-advocate/src/index.ts"),
      "@truemandate/provenance-judge": path.join(root, "agents/provenance-judge/src/index.ts"),
      "@truemandate/evidence-judge": path.join(root, "agents/evidence-judge/src/index.ts"),
      "@truemandate/guardian": path.join(root, "agents/guardian/src/index.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      "agents/*/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
      "integrations/*/src/**/*.test.ts",
    ],
  },
});
