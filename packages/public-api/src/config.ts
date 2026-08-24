export interface PublicBffConfig {
  readonly serviceName: string;
  readonly projectId: string;
  readonly persistence: "memory" | "firestore";
  readonly port: number;
  readonly host: string;
}

export interface CreatePublicBffOptions {
  readonly requireConfig?: boolean;
  readonly config?: Partial<PublicBffConfig>;
}

const DEFAULTS: PublicBffConfig = {
  serviceName: "public-bff",
  projectId: "",
  persistence: "memory",
  port: 8080,
  host: "0.0.0.0",
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

  const config: PublicBffConfig = {
    serviceName: options.config?.serviceName ?? process.env.TM_SERVICE_NAME ?? DEFAULTS.serviceName,
    projectId: options.config?.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "",
    persistence,
    port: options.config?.port ?? Number(process.env.PORT ?? DEFAULTS.port),
    host: options.config?.host ?? process.env.HOST ?? DEFAULTS.host,
  };

  if (options.requireConfig) {
    const missing: string[] = [];
    if (!config.projectId.trim()) missing.push("GOOGLE_CLOUD_PROJECT");
    if (!config.serviceName.trim()) missing.push("TM_SERVICE_NAME");
    if (config.persistence === "firestore" && !config.projectId.trim()) {
      missing.push("TM_PERSISTENCE=firestore requires GOOGLE_CLOUD_PROJECT");
    }
    if (missing.length > 0) {
      throw new PublicBffConfigError(
        `Missing critical public-bff config: ${missing.join(", ")}`,
      );
    }
  }

  return config;
}
