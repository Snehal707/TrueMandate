export interface PublicBffConfig {
  readonly serviceName: string;
  readonly projectId: string;
  readonly persistence: "memory" | "firestore";
  readonly port: number;
  readonly host: string;
  /**
   * Application-level allowlist for the narrow demo evidence-provisioning
   * route (independent of, and in addition to, Cloud Run IAM). Empty by
   * default — the route does not even register unless this is configured
   * (deployed as phase-c-verifier only). Ordinary public routes (/v1/evidence
   * included) never consult this.
   */
  readonly demoEvidenceProvisionCallerEmails: readonly string[];
  /** Expected OIDC audience for verifying that allowlist. Required only if
   * demoEvidenceProvisionCallerEmails is non-empty. */
  readonly internalAuthAudience?: string;
}

export interface CreatePublicBffOptions {
  readonly requireConfig?: boolean;
  readonly config?: Partial<PublicBffConfig>;
}

const DEFAULTS: Omit<PublicBffConfig, "internalAuthAudience"> = {
  serviceName: "public-bff",
  projectId: "",
  persistence: "memory",
  port: 8080,
  host: "0.0.0.0",
  demoEvidenceProvisionCallerEmails: [],
};

export class PublicBffConfigError extends Error {
  readonly code = "PUBLIC_BFF_CONFIG_MISSING";

  constructor(message: string) {
    super(message);
    this.name = "PublicBffConfigError";
  }
}

export function loadPublicBffConfig(
  options: CreatePublicBffOptions = {},
): PublicBffConfig {
  const envPersistence = process.env.TM_PERSISTENCE;
  const persistence =
    options.config?.persistence ??
    (envPersistence === "firestore" ? "firestore" : "memory");

  const demoEvidenceProvisionCallerEmails =
    options.config?.demoEvidenceProvisionCallerEmails ??
    (process.env.TM_DEMO_EVIDENCE_PROVISION_CALLER_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  const config: PublicBffConfig = {
    serviceName: options.config?.serviceName ?? process.env.TM_SERVICE_NAME ?? DEFAULTS.serviceName,
    projectId: options.config?.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "",
    persistence,
    port: options.config?.port ?? Number(process.env.PORT ?? DEFAULTS.port),
    host: options.config?.host ?? process.env.HOST ?? DEFAULTS.host,
    demoEvidenceProvisionCallerEmails,
    internalAuthAudience: options.config?.internalAuthAudience ?? process.env.TM_INTERNAL_AUTH_AUDIENCE?.trim() ?? undefined,
  };

  if (options.requireConfig) {
    const missing: string[] = [];
    if (!config.projectId.trim()) missing.push("GOOGLE_CLOUD_PROJECT");
    if (!config.serviceName.trim()) missing.push("TM_SERVICE_NAME");
    if (config.persistence === "firestore" && !config.projectId.trim()) {
      missing.push("TM_PERSISTENCE=firestore requires GOOGLE_CLOUD_PROJECT");
    }
    if (config.demoEvidenceProvisionCallerEmails.length > 0 && !config.internalAuthAudience?.trim()) {
      missing.push("TM_INTERNAL_AUTH_AUDIENCE (required when TM_DEMO_EVIDENCE_PROVISION_CALLER_EMAILS is set)");
    }
    if (missing.length > 0) {
      throw new PublicBffConfigError(
        `Missing critical public-bff config: ${missing.join(", ")}`,
      );
    }
  }

  return config;
}
