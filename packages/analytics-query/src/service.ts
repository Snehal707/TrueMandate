import type { Result } from "@truemandate/protocol";
import {
  runAmbiguityBlockedCorrelation,
  type AmbiguityBlockedRow,
} from "./queries/ambiguity-blocked-correlation.js";
import {
  runCounterpartyOutcomeCorrelation,
  type CounterpartyOutcomeRow,
} from "./queries/counterparty-outcome-correlation.js";
import {
  runGuardianInterventionAgents,
  type GuardianInterventionAgentRow,
} from "./queries/guardian-intervention-agents.js";
import {
  runProvenanceTraversal,
  type ProvenanceTraversalParams,
  type ProvenanceTraversalResult,
} from "./queries/provenance-traversal.js";
import {
  runRemedyRestorationRate,
  type RemedyRestorationRow,
} from "./queries/remedy-restoration-rate.js";
import {
  runWeakenedConstraints,
  type WeakenedConstraintRow,
} from "./queries/weakened-constraints.js";
import type { BigQueryQueryPort } from "./query-port.js";
import type { AnalyticsQueryWindow } from "./window.js";

/**
 * Read-only cross-workflow analytics facade.
 * Must never be imported by Authority / Gateway privilege paths.
 */
export class CrossWorkflowAnalyticsService {
  constructor(
    private readonly port: BigQueryQueryPort,
    private readonly datasetId = "tm_analytics",
  ) {}

  weakenedConstraints(
    window: AnalyticsQueryWindow = {},
  ): Promise<Result<readonly WeakenedConstraintRow[]>> {
    return runWeakenedConstraints(this.port, window, this.datasetId);
  }

  guardianInterventionAgents(
    window: AnalyticsQueryWindow = {},
  ): Promise<Result<readonly GuardianInterventionAgentRow[]>> {
    return runGuardianInterventionAgents(this.port, window, this.datasetId);
  }

  counterpartyOutcomeCorrelation(
    window: AnalyticsQueryWindow = {},
  ): Promise<Result<readonly CounterpartyOutcomeRow[]>> {
    return runCounterpartyOutcomeCorrelation(this.port, window, this.datasetId);
  }

  ambiguityBlockedCorrelation(
    window: AnalyticsQueryWindow = {},
  ): Promise<Result<readonly AmbiguityBlockedRow[]>> {
    return runAmbiguityBlockedCorrelation(this.port, window, this.datasetId);
  }

  remedyRestorationRate(
    window: AnalyticsQueryWindow = {},
  ): Promise<Result<readonly RemedyRestorationRow[]>> {
    return runRemedyRestorationRate(this.port, window, this.datasetId);
  }

  provenanceTraversal(
    params: ProvenanceTraversalParams,
  ): Promise<Result<ProvenanceTraversalResult>> {
    return runProvenanceTraversal(this.port, params);
  }
}
