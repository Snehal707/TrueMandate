import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { TraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";

export interface InitTracingOptions {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly projectId?: string;
}

export interface TracingHandle {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}

const NOOP_HANDLE: TracingHandle = {
  enabled: false,
  shutdown: async () => {},
};

/**
 * Bootstraps OpenTelemetry tracing with a Cloud Trace exporter.
 *
 * Fail-open at startup: tracing is observability, not a security invariant
 * (see AGENTS.md / Wave 2 foundation plan). Any initialization failure
 * (missing credentials, disabled API, packaging issue, etc.) is caught,
 * logged as a warning, and a no-op handle is returned so service boot is
 * never blocked or failed by telemetry setup.
 */
export function initTracing(options: InitTracingOptions): TracingHandle {
  if (process.env.TM_TRACING_DISABLED === "true") {
    return NOOP_HANDLE;
  }

  try {
    const projectId =
      options.projectId ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCP_PROJECT ??
      undefined;

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
        ...(options.serviceVersion
          ? { [ATTR_SERVICE_VERSION]: options.serviceVersion }
          : {}),
      }),
      // NOTE: @google-cloud/opentelemetry-cloud-trace-exporter is deprecated
      // upstream (archival planned after 2026-10-30) in favor of native OTLP
      // endpoints. It is used here per the Wave 2 foundation implementation
      // plan; migrating to an OTLP exporter against Cloud Trace's OTLP
      // endpoint is a documented follow-up, not a silently dropped concern.
      traceExporter: new TraceExporter(projectId ? { projectId } : {}),
      // textMapPropagator intentionally omitted: falls back to
      // getPropagatorFromEnv(), which defaults to W3C tracecontext+baggage.
    });

    sdk.start();

    let shutDown = false;
    return {
      enabled: true,
      shutdown: async () => {
        if (shutDown) return;
        shutDown = true;
        try {
          await sdk.shutdown();
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: "tracing_shutdown_failed",
              service: options.serviceName,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "tracing_init_failed",
        service: options.serviceName,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NOOP_HANDLE;
  }
}
