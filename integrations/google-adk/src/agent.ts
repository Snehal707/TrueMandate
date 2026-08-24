import { FunctionTool, LlmAgent } from "@google/adk";
import {
  buildGovernedSdkAdkToolset,
  type GovernedAdkToolDefinition,
} from "@truemandate/sdk-adk";

/**
 * TrueMandate reference agent on the official Google ADK (JS) package.
 *
 * Governance stance: this agent uses the governed public lifecycle exposed by
 * @truemandate/sdk-core through @truemandate/sdk-adk. It can record intents,
 * submit/read/resume governed workflows, read/respond to approvals, submit/read
 * evidence, and inspect outcome/resolution status. It still holds NO direct
 * economic execution surface and NO authority of its own.
 *
 * Model backend: Vertex AI with Application Default Credentials — verified
 * against the installed packages (@google/adk@1.6.0 models/google_llm.js;
 * @google/genai@2.17.1 dist/node/index.mjs):
 *   GOOGLE_GENAI_USE_VERTEXAI=true  -> Vertex mode (no API key required;
 *                                       ADK throws only when NEITHER vertexai
 *                                       NOR apiKey is set)
 *   GOOGLE_CLOUD_PROJECT            -> Vertex project
 *   GOOGLE_CLOUD_LOCATION           -> Vertex location
 *   ADC (application default credentials, or a Cloud Run service identity
 *   after deployment)               -> authentication
 * No Gemini AI Studio API key is used or required.
 */

/** Public base URL the agent reaches (the deployed web proxy in production). */
export function tmBaseUrl(): string {
  return process.env.TM_PUBLIC_BASE_URL ?? "http://localhost:5173";
}

function toGoogleFunctionTool(tool: GovernedAdkToolDefinition): FunctionTool {
  return new FunctionTool({
    name: tool.name,
    description: tool.description,
    // sdk-adk owns the governed Zod object schemas; the Google ADK surface
    // consumes them here without re-defining lifecycle contracts locally.
    parameters:
      tool.parameters as unknown as ConstructorParameters<typeof FunctionTool>[0]["parameters"],
    execute: (input) => tool.execute(input),
  });
}

export function buildTrueMandateTools() {
  const toolset = buildGovernedSdkAdkToolset({ baseUrl: tmBaseUrl() });

  const recordIntent = toGoogleFunctionTool(toolset.recordIntent);
  const readCanonicalProof = toGoogleFunctionTool(toolset.readCanonicalProof);
  const submitWorkflow = toGoogleFunctionTool(toolset.submitWorkflow);
  const readWorkflow = toGoogleFunctionTool(toolset.readWorkflow);
  const resumeWorkflow = toGoogleFunctionTool(toolset.resumeWorkflow);
  const readApproval = toGoogleFunctionTool(toolset.readApproval);
  const decideApproval = toGoogleFunctionTool(toolset.decideApproval);
  const submitEvidence = toGoogleFunctionTool(toolset.submitEvidence);
  const readEvidence = toGoogleFunctionTool(toolset.readEvidence);
  const readOutcome = toGoogleFunctionTool(toolset.readOutcome);
  const readResolutionCase = toGoogleFunctionTool(toolset.readResolutionCase);
  const readResolutionByOutcome = toGoogleFunctionTool(
    toolset.readResolutionByOutcome,
  );

  return {
    core: toolset.core,
    tools: [
      recordIntent,
      readCanonicalProof,
      submitWorkflow,
      readWorkflow,
      resumeWorkflow,
      readApproval,
      decideApproval,
      submitEvidence,
      readEvidence,
      readOutcome,
      readResolutionCase,
      readResolutionByOutcome,
    ],
    recordIntent,
    readCanonicalProof,
    submitWorkflow,
    readWorkflow,
    resumeWorkflow,
    readApproval,
    decideApproval,
    submitEvidence,
    readEvidence,
    readOutcome,
    readResolutionCase,
    readResolutionByOutcome,
  };
}

export const ROOT_AGENT_INSTRUCTION = [
  "You are the TrueMandate governed workflow reference agent (Google ADK).",
  "Your A2A-exposed tools are all backed by the same governed public lifecycle as sdk-core and sdk-adk:",
  "  - record durable intents",
  "  - submit/read/resume governed workflows",
  "  - read/respond to approvals",
  "  - submit/read evidence",
  "  - read outcome and resolution state",
  "You have NO AuthorityGrant surface, NO PreparedAction surface, NO CommitToken surface,",
  "NO raw Gateway commit surface, and NO authority of your own. Never claim you can pay,",
  "purchase, commit, or execute anything directly. When asked to spend money, explain that",
  "TrueMandate infrastructure authorizes execution and that your role is limited to the governed",
  "workflow lifecycle on safe public surfaces.",
  "These public tools never bypass Guardian, Adaptive Authority, approval or monitoring,",
  "PREPARE, AUTHORIZE, COMMIT, or outcome and resolution governance.",
].join("\n");

/** Vertex AI model (env-overridable); default per the product config. */
export function defaultModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
}

export function buildRootAgent() {
  return new LlmAgent({
    name: "truemandate_governed_agent",
    description:
      "Governed workflow agent with zero direct economic execution surface.",
    model: defaultModel(),
    instruction: ROOT_AGENT_INSTRUCTION,
    tools: buildTrueMandateTools().tools,
  });
}

export const rootAgent = buildRootAgent();
