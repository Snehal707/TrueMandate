/**
 * Browser-safe entry for @truemandate/benchmark-runner (vite alias target).
 * Re-exports the runner + SUT adapters only — artifacts/cli use node:fs and
 * must never enter the browser bundle.
 */
export * from "../../../../services/benchmark-runner/src/runner.js";
export * from "../../../../services/benchmark-runner/src/adapters.js";
