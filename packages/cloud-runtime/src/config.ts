export class RuntimeConfigError extends Error {
  readonly code = "RUNTIME_CONFIG_MISSING";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

export interface RuntimeConfig {
  readonly serviceName: string;
  readonly projectId: string;
  readonly persistence: "memory" | "firestore";
  readonly port: number;
  readonly host: string;
  readonly requireConfig: boolean;
  readonly requirePushAuth: boolean;
  readonly requireInternalAuth: boolean;
  readonly internalAllowedCallers: readonly string[];
  readonly verifyInternalAuth: boolean;
  readonly internalAuthAudience?: string;
  readonly authorityCallerEmail?: string;
  readonly outcomeResolutionCallerEmail?: string;
  readonly gatewayCallerEmail?: string;
  readonly commitCallerEmail?: string;
  readonly workflowCallerEmails: readonly string[];
  readonly workflowCommitCallerEmails: readonly string[];
  readonly executionCallerEmails: readonly string[];
  readonly phaseBFixtureCallerEmail?: string;
  readonly phaseCVerifierCallerEmail?: string;
  /** Wave 1 acceptance verifier identity (remedy lifecycle + wave1 fixtures). */
  readonly wave1VerifierCallerEmail?: string;
  readonly intentProvenanceUrl?: string;
  readonly gatewayUrl?: string;
  readonly evidenceUrl?: string;
  readonly authorityUrl?: string;
  readonly learningUrl?: string;
  readonly outcomeResolutionUrl?: string;
  readonly agentRuntimeUrl?: string;
  readonly modelArmorTemplate?: string;
  readonly vertexProject?: string;
  readonly vertexLocation: string;
  readonly geminiModel: string;
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const requireConfig = env.TM_REQUIRE_CONFIG !== "false";
  const persistence = env.TM_PERSISTENCE === "firestore" ? "firestore" : "memory";
  const config: RuntimeConfig = {
    serviceName: env.TM_SERVICE_NAME ?? "",
    projectId: env.GOOGLE_CLOUD_PROJECT ?? env.GCP_PROJECT ?? "",
    persistence,
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? "0.0.0.0",
    requireConfig,
    requirePushAuth: env.TM_REQUIRE_PUSH_AUTH === "true",
    requireInternalAuth: env.TM_REQUIRE_INTERNAL_AUTH === "true",
    internalAllowedCallers: (env.TM_INTERNAL_ALLOWED_CALLERS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    verifyInternalAuth: env.TM_INTERNAL_AUTH_VERIFY === "true",
    internalAuthAudience: env.TM_INTERNAL_AUTH_AUDIENCE?.trim() || undefined,
    authorityCallerEmail: env.TM_AUTHORITY_CALLER_EMAIL?.trim() || undefined,
    outcomeResolutionCallerEmail: env.TM_OUTCOME_RESOLUTION_CALLER_EMAIL?.trim() || undefined,
    gatewayCallerEmail: env.TM_GATEWAY_CALLER_EMAIL?.trim() || undefined,
    commitCallerEmail: env.TM_COMMIT_CALLER_EMAIL?.trim() || undefined,
    workflowCallerEmails: (env.TM_WORKFLOW_CALLER_EMAIL ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    workflowCommitCallerEmails: (env.TM_WORKFLOW_COMMIT_CALLER_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    executionCallerEmails: (env.TM_EXECUTION_CALLER_EMAIL ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    phaseBFixtureCallerEmail: env.TM_PHASE_B_FIXTURE_CALLER_EMAIL?.trim() || undefined,
    phaseCVerifierCallerEmail: env.TM_PHASE_C_VERIFIER_CALLER_EMAIL?.trim() || undefined,
    wave1VerifierCallerEmail: env.TM_WAVE1_VERIFIER_CALLER_EMAIL?.trim() || undefined,
    intentProvenanceUrl: env.INTENT_PROVENANCE_URL?.trim() || undefined,
    gatewayUrl: env.GATEWAY_URL?.trim() || undefined,
    evidenceUrl: env.EVIDENCE_URL?.trim() || undefined,
    authorityUrl: env.AUTHORITY_URL?.trim() || undefined,
    learningUrl: env.LEARNING_URL?.trim() || undefined,
    outcomeResolutionUrl: env.OUTCOME_RESOLUTION_URL?.trim() || undefined,
    agentRuntimeUrl: env.AGENT_RUNTIME_URL?.trim() || undefined,
    modelArmorTemplate: env.TM_MODEL_ARMOR_TEMPLATE?.trim() || undefined,
    vertexProject: env.VERTEX_PROJECT?.trim() || undefined,
    vertexLocation: env.VERTEX_LOCATION ?? "global",
    geminiModel: env.GEMINI_MODEL ?? "gemini-3.7-flash",
  };

  if (requireConfig) {
    const missing: string[] = [];
    if (!config.projectId.trim()) missing.push("GOOGLE_CLOUD_PROJECT");
    if (!config.serviceName.trim()) missing.push("TM_SERVICE_NAME");
    if (persistence === "firestore" && !config.projectId.trim()) {
      missing.push("TM_PERSISTENCE=firestore requires GOOGLE_CLOUD_PROJECT");
    }
    if (config.verifyInternalAuth && !config.internalAuthAudience) {
      missing.push("TM_INTERNAL_AUTH_AUDIENCE");
    }
    if (
      config.requireInternalAuth &&
      config.internalAllowedCallers.length > 0 &&
      !config.verifyInternalAuth
    ) {
      missing.push("TM_INTERNAL_AUTH_VERIFY=true for TM_INTERNAL_ALLOWED_CALLERS");
    }
    if (missing.length > 0) {
      throw new RuntimeConfigError(
        `Missing critical runtime config: ${missing.join(", ")}`,
      );
    }
  }

  return config;
}

export function requireVertexConfig(config: RuntimeConfig): void {
  if (!config.vertexProject) {
    throw new RuntimeConfigError("VERTEX_PROJECT not set");
  }
}

export function requireModelArmorConfig(config: RuntimeConfig): void {
  if (!config.modelArmorTemplate) {
    throw new RuntimeConfigError("TM_MODEL_ARMOR_TEMPLATE not set");
  }
}

export function requireIntentProvenanceUrl(config: RuntimeConfig): void {
  if (!config.intentProvenanceUrl) {
    throw new RuntimeConfigError("INTENT_PROVENANCE_URL not set");
  }
}

export function requireInternalAllowedCallers(config: RuntimeConfig): void {
  if (config.internalAllowedCallers.length === 0) {
    throw new RuntimeConfigError("TM_INTERNAL_ALLOWED_CALLERS not set");
  }
}

export function requireGatewayUrl(config: RuntimeConfig): void {
  if (!config.gatewayUrl) {
    throw new RuntimeConfigError("GATEWAY_URL not set");
  }
}

export function requireAuthorityCallerEmail(config: RuntimeConfig): string {
  if (!config.authorityCallerEmail) {
    throw new RuntimeConfigError("TM_AUTHORITY_CALLER_EMAIL not set");
  }
  return config.authorityCallerEmail;
}

export function requireOutcomeResolutionCallerEmail(config: RuntimeConfig): string {
  if (!config.outcomeResolutionCallerEmail) {
    throw new RuntimeConfigError("TM_OUTCOME_RESOLUTION_CALLER_EMAIL not set");
  }
  return config.outcomeResolutionCallerEmail;
}

export function requireGatewayCallerEmail(config: RuntimeConfig): string {
  if (!config.gatewayCallerEmail) {
    throw new RuntimeConfigError("TM_GATEWAY_CALLER_EMAIL not set");
  }
  return config.gatewayCallerEmail;
}

export function requireCommitCallerEmail(config: RuntimeConfig): string {
  if (!config.commitCallerEmail) {
    throw new RuntimeConfigError("TM_COMMIT_CALLER_EMAIL not set");
  }
  return config.commitCallerEmail;
}

export function requireEvidenceUrl(config: RuntimeConfig): void {
  if (!config.evidenceUrl) throw new RuntimeConfigError("EVIDENCE_URL not set");
}

export function requireAuthorityUrl(config: RuntimeConfig): void {
  if (!config.authorityUrl) throw new RuntimeConfigError("AUTHORITY_URL not set");
}

export function requireLearningUrl(config: RuntimeConfig): void {
  if (!config.learningUrl) throw new RuntimeConfigError("LEARNING_URL not set");
}

export function requireOutcomeResolutionUrl(config: RuntimeConfig): void {
  if (!config.outcomeResolutionUrl) throw new RuntimeConfigError("OUTCOME_RESOLUTION_URL not set");
}

export function requireAgentRuntimeUrl(config: RuntimeConfig): void {
  if (!config.agentRuntimeUrl) throw new RuntimeConfigError("AGENT_RUNTIME_URL not set");
}
