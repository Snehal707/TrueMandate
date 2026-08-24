import { DemoRuntime } from "@truemandate/observability-service";
import type {
  ApprovalArtifact,
  ApprovalDecision,
  PreparedAction,
} from "@truemandate/protocol";
import type {
  GraphFilter,
  IntentWorkspaceView,
  ObservabilityEvent,
  ObservabilityHandler,
  ObservabilityTopic,
} from "@truemandate/read-model";

/**
 * Browser-safe observability facade.
 * Does not expose grant stores, gateway, or mutation services.
 */
export interface ObservabilityClient {
  seedProcurementPartial(): Promise<{ readonly intentId: string }>;
  seedAtRiskDelivery(): Promise<{ readonly intentId: string }>;
  seedScenario(id: string): Promise<{ readonly intentId: string }>;
  getWorkspace(
    intentId: string,
    opts?: { readonly graphFilter?: GraphFilter },
  ): Promise<IntentWorkspaceView>;
  submitApproval(input: {
    readonly prepared: PreparedAction;
    readonly principalId: string;
    readonly decision: ApprovalDecision;
  }): ApprovalArtifact;
  getPendingApproval(): ApprovalArtifact | undefined;
  subscribe(topic: ObservabilityTopic, handler: ObservabilityHandler): () => void;
  /** Snapshot of last published events (for Attack Lab comparisons). */
  drainEventLog(): readonly ObservabilityEvent[];
}

class InProcessObservabilityClient implements ObservabilityClient {
  private readonly runtime = new DemoRuntime();
  private readonly log: ObservabilityEvent[] = [];

  constructor() {
    this.runtime.getEventPort().subscribe("*", (e) => {
      this.log.push(e);
    });
  }

  seedProcurementPartial(): Promise<{ readonly intentId: string }> {
    return this.runtime.seedProcurementPartial();
  }

  seedAtRiskDelivery(): Promise<{ readonly intentId: string }> {
    return this.runtime.seedAtRiskDelivery();
  }

  seedScenario(id: string): Promise<{ readonly intentId: string }> {
    if (id === "at-risk" || id === "AT_RISK") return this.seedAtRiskDelivery();
    return this.seedProcurementPartial();
  }

  getWorkspace(
    intentId: string,
    opts?: { readonly graphFilter?: GraphFilter },
  ): Promise<IntentWorkspaceView> {
    return this.runtime.getWorkspace(intentId, opts);
  }

  submitApproval(input: {
    readonly prepared: PreparedAction;
    readonly principalId: string;
    readonly decision: ApprovalDecision;
  }): ApprovalArtifact {
    return this.runtime.submitApproval(input);
  }

  getPendingApproval(): ApprovalArtifact | undefined {
    return this.runtime.getPendingApproval();
  }

  subscribe(topic: ObservabilityTopic, handler: ObservabilityHandler): () => void {
    return this.runtime.getEventPort().subscribe(topic, handler);
  }

  drainEventLog(): readonly ObservabilityEvent[] {
    return [...this.log];
  }
}

export function createObservabilityClient(): ObservabilityClient {
  return new InProcessObservabilityClient();
}
