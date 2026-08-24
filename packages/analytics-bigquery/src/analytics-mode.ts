export type AnalyticsExportMode = "disabled" | "memory" | "bigquery";

/**
 * TM_ANALYTICS_EXPORT=disabled|memory|bigquery (default: disabled).
 * Mirrors persistenceModeFromEnv — privileged paths never consult this.
 */
export function analyticsExportModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsExportMode {
  const raw = (env.TM_ANALYTICS_EXPORT ?? "disabled").trim().toLowerCase();
  if (raw === "memory" || raw === "bigquery" || raw === "disabled") {
    return raw;
  }
  return "disabled";
}
