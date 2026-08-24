/**
 * Browser-safe entry for @truemandate/safe-benchmark (vite alias target).
 * Re-exports ONLY the pure modules — registry/write-generated use node:fs
 * and must never enter the browser bundle.
 */
export * from "../../../../packages/safe-benchmark/src/scenario-schema.js";
export * from "../../../../packages/safe-benchmark/src/sut-types.js";
export * from "../../../../packages/safe-benchmark/src/generate-catalog.js";
export * from "../../../../packages/safe-benchmark/src/evaluator.js";
export * from "../../../../packages/safe-benchmark/src/metrics.js";
