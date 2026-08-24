/**
 * @truemandate/sdk-agent — the agent-developer surface.
 * Propose (typed, local) · transport (sdk-core) · verify (tool registry).
 * Infrastructure authorizes.
 */
export * from "./agent-sdk.js";
export type { ToolDescriptor, ActionProposal, Result } from "@truemandate/protocol";
export type { SdkCore } from "@truemandate/sdk-core";
