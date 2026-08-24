import {
  AnalyticsExporter,
  AnalyticsTable,
  GoogleBigQueryExportPort,
  MemoryBigQueryExportPort,
  analyticsExportModeFromEnv,
  createDocumentAnalyticsLedger,
  type AnalyticsLedgerEntry,
  type BigQueryExportPort,
  type ProvenanceEdgeExportInput,
  type ProvenanceNodeExportInput,
} from "@truemandate/analytics-bigquery";
import type { CloudEventEnvelope, PubSubTopic } from "@truemandate/cloud-pubsub";
import { ok, type Result } from "@truemandate/protocol";

export interface AnalyticsExportServicePorts {
  readonly ledgerStore: {
    get(id: string): Promise<AnalyticsLedgerEntry | undefined>;
    put(id: string, value: AnalyticsLedgerEntry): Promise<void>;
  };
  readonly bigquery?: BigQueryExportPort;
  readonly datasetId?: string;
  readonly projectId?: string;
}

/**
 * Thin wrapper composing AnalyticsExporter with Firestore ledger + BQ port.
 */
export class AnalyticsExportService {
  readonly exporter: AnalyticsExporter;
  readonly port: BigQueryExportPort;

  private constructor(exporter: AnalyticsExporter, port: BigQueryExportPort) {
    this.exporter = exporter;
    this.port = port;
  }

  static async create(
    ports: AnalyticsExportServicePorts,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<AnalyticsExportService> {
    const mode = analyticsExportModeFromEnv(env);
    let port: BigQueryExportPort;
    if (ports.bigquery) {
      port = ports.bigquery;
    } else if (mode === "bigquery") {
      const projectId =
        ports.projectId ??
        env.GOOGLE_CLOUD_PROJECT ??
        env.GCP_PROJECT ??
        "";
      if (!projectId.trim()) {
        throw new Error(
          "TM_ANALYTICS_EXPORT=bigquery requires GOOGLE_CLOUD_PROJECT",
        );
      }
      port = await GoogleBigQueryExportPort.create({
        projectId,
        datasetId: ports.datasetId ?? env.TM_BQ_DATASET ?? "tm_analytics",
      });
    } else {
      // disabled and memory both use in-process capture (disabled = no-op sink).
      port = new MemoryBigQueryExportPort(
        mode === "disabled" ? { failInserts: false } : {},
      );
    }

    const ledger = createDocumentAnalyticsLedger(ports.ledgerStore);
    return new AnalyticsExportService(
      new AnalyticsExporter({ port, ledger }),
      port,
    );
  }

  async onGovernanceEvent(
    topic: PubSubTopic,
    envelope: CloudEventEnvelope,
  ): Promise<Result<{ readonly status: "exported" | "skipped" }>> {
    return this.exporter.exportGovernanceEvent(topic, envelope);
  }
}

export interface ProvenanceExportBatchPorts {
  readonly listNodes: () => Promise<readonly ProvenanceNodeExportInput[]>;
  readonly listEdges: () => Promise<readonly ProvenanceEdgeExportInput[]>;
  readonly exporter: AnalyticsExporter;
}

/**
 * One-shot provenance node/edge export for a future Cloud Run Job.
 * No always-on polling — invocable on demand.
 */
export async function runProvenanceExportBatch(
  ports: ProvenanceExportBatchPorts,
): Promise<
  Result<{
    readonly nodesExported: number;
    readonly nodesSkipped: number;
    readonly edgesExported: number;
    readonly edgesSkipped: number;
  }>
> {
  let nodesExported = 0;
  let nodesSkipped = 0;
  let edgesExported = 0;
  let edgesSkipped = 0;

  for (const node of await ports.listNodes()) {
    const r = await ports.exporter.exportProvenanceNode(node);
    if (!r.ok) return r;
    if (r.value.status === "exported") nodesExported += 1;
    else nodesSkipped += 1;
  }
  for (const edge of await ports.listEdges()) {
    const r = await ports.exporter.exportProvenanceEdge(edge);
    if (!r.ok) return r;
    if (r.value.status === "exported") edgesExported += 1;
    else edgesSkipped += 1;
  }

  return ok({
    nodesExported,
    nodesSkipped,
    edgesExported,
    edgesSkipped,
  });
}

export { AnalyticsTable };
