/**
 * Canonical Phase C v5 demo projection — shared shape between:
 *   - the frozen embedded fallback in apps/web (kind "…-frozen"), and
 *   - the live read-only Public BFF projection (kind "…-live-read").
 *
 * Read-only by contract: no UI or route ever mutates these records.
 */

export type DemoProjectionKind =
  | "canonical-phase-c-v5-frozen"
  | "canonical-phase-c-v5-live-read";

export interface CanonicalProjection {
  readonly meta: {
    readonly projectionKind: DemoProjectionKind;
    readonly capturedAt: string;
    readonly executionId: string;
    readonly executionStart: string;
    readonly executionEnd: string;
    readonly exitCode: 0;
    readonly verifierImageDigest: string;
    readonly outcomeResolutionImageDigest: string;
    readonly readOnly: true;
  };
  readonly intent: {
    readonly id: string;
    readonly rawText: string;
    readonly principalId: string;
    readonly createdAt: string;
    readonly contentHash: string;
    readonly intentStateId: string;
  };
  readonly constraints: readonly {
    readonly concept: string;
    readonly operator: string;
    readonly value: string | number;
    readonly kind: string;
    readonly mutability: string;
    readonly sourceText: string;
    readonly sourceSpan: { readonly start: number; readonly end: number };
  }[];
  readonly guardian: {
    readonly verdictId: string;
    readonly decision: string;
    readonly semanticStatus: string;
    readonly criticalFailure: boolean;
    readonly overallFidelity: number;
    readonly modelName: string;
    readonly createdAt: string;
    readonly judges: readonly { readonly judgeId: string; readonly status: string; readonly schema: string }[];
  };
  readonly authority: {
    readonly evaluationId: string;
    readonly decision: string;
    readonly capability: string;
    readonly merchant: string;
    readonly amount: number;
    readonly currency: string;
    readonly expiresAt: string;
    readonly materializationEligible: boolean;
    readonly recordHash: string;
    readonly grantId: string;
    readonly grantState: string;
    readonly grantConsumedAt: string;
  };
  readonly preparedAction: {
    readonly id: string;
    readonly toolId: string;
    readonly amount: number;
    readonly currency: string;
    readonly merchant: string;
    readonly quantity: number;
    readonly product: string;
    readonly lifecycle: string;
    readonly parameterHash: string;
    readonly guardianVerdictHash: string;
    readonly createdAt: string;
  };
  readonly execution: {
    readonly commitTokenId: string;
    readonly commitTokenConsumed: boolean;
    readonly sideEffectId: string;
    readonly toolId: string;
    readonly resultState: string;
    readonly externalReference: string;
    readonly amount: number;
    readonly currency: string;
    readonly counterparty: string;
    readonly requestTimestamp: string;
    readonly replayStatus: string;
    readonly replaySameResultRef: boolean;
    readonly idempotencyKey: string;
    readonly sideEffectCountForFixture: number;
  };
  readonly outcome: {
    readonly contractId: string;
    readonly state: string;
    readonly paymentStatus: string;
    readonly createdAt: string;
    readonly executionBegunAt: string;
    readonly updatedAt: string;
    readonly version: number;
    readonly definitionHash: string;
    readonly paymentSettledAt: string;
    readonly partialAt: string;
    readonly requirements: readonly {
      readonly concept: string;
      readonly state: string;
      readonly expected: string | number;
    }[];
    readonly divergence: {
      readonly requiredQuantity: number;
      readonly verifiedReceived: number;
      readonly shortfall: number;
      readonly evidenceClaimIds: readonly string[];
    };
  };
  readonly evidence: {
    readonly authorizationEnvelopes: readonly {
      readonly id: string;
      readonly source: string;
      readonly concept: string;
      readonly value: string | number | boolean;
    }[];
    readonly deliveryEnvelopes: readonly {
      readonly id: string;
      readonly source: string;
      readonly concept: string;
      readonly value: string | number | boolean | null;
    }[];
    readonly claims: readonly {
      readonly id: string;
      readonly concept: string;
      readonly value: string | number | boolean | null;
    }[];
  };
  readonly resolution: {
    readonly caseId: string;
    readonly state: string;
    readonly responsibilityState: string;
    readonly openedAt: string;
    readonly triggerEventId: string;
    readonly triggerIdentity: string;
    readonly caseVersion: number;
    readonly recursionDepth: number;
    readonly firstDivergence: string;
    readonly rootCauseEstablished: boolean;
    readonly evidenceRequests: readonly {
      readonly id: string;
      readonly questionResolved: string;
      readonly evidenceSought: string;
      readonly targetSource: string;
      readonly requiresAuthority: boolean;
      readonly hypothesesDistinguished: readonly string[];
      readonly urgency: string;
    }[];
    readonly remedyExecutions: number;
  };
  readonly preservation: {
    readonly phaseACanonicalTokenId: string;
    readonly phaseACanonicalTokenConsumed: boolean;
    readonly phaseBAndCv1to4Intact: boolean;
    readonly remediationMandatesCount: number;
  };
  readonly timeline: readonly {
    readonly at: string;
    readonly type: string;
    readonly summary: string;
    readonly source: string;
  }[];
  readonly provenanceChain: readonly {
    readonly step: string;
    readonly canonicalId: string;
    readonly kind: string;
  }[];
}
