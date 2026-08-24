/**
 * @truemandate/sdk-core — framework-neutral TrueMandate client.
 *
 * Type-only re-exports of the trust-core vocabulary (no authority surface —
 * no grant, token, gateway, or mint types are exported by this SDK).
 */
export * from "./types.js";
export * from "./client.js";
export type { ErrorCode, Result } from "@truemandate/protocol";
export type { Intent, IntentState } from "@truemandate/protocol";
export type { CanonicalProjection, IntentWorkspaceView } from "@truemandate/read-model";
