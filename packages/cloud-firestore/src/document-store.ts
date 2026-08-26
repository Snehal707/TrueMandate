/**
 * Transactional document store. MemoryTransactionalStore is for tests/local.
 * Production uses GoogleFirestoreDocumentStore and awaits every commit.
 */

export type DocPath = string;

export interface TxContext {
  get<T = unknown>(path: DocPath): Promise<T | undefined>;
  set<T>(path: DocPath, value: T): Promise<void>;
  delete(path: DocPath): Promise<void>;
}

export interface DocumentStore {
  readonly kind: "memory" | "firestore";
  runTransaction<T>(fn: (tx: TxContext) => Promise<T> | T): Promise<T>;
  get<T = unknown>(path: DocPath): Promise<T | undefined>;
  listCollection<T = unknown>(collection: string): Promise<readonly T[]>;
  set<T>(path: DocPath, value: T): Promise<void>;
  delete?(path: DocPath): Promise<void>;
  /** Real Get. Missing document is success. Thrown API errors are failure. */
  probeReachability(): Promise<void>;
}

/**
 * In-process optimistic TX. Used only when TM_PERSISTENCE=memory.
 * Concurrent runTransaction calls are queued (single-process).
 */
export class MemoryTransactionalStore implements DocumentStore {
  readonly kind = "memory" as const;
  private readonly docs = new Map<string, unknown>();
  private chain: Promise<void> = Promise.resolve();

  async get<T = unknown>(path: DocPath): Promise<T | undefined> {
    return this.docs.get(path) as T | undefined;
  }

  async set<T>(path: DocPath, value: T): Promise<void> {
    this.docs.set(path, value);
  }

  async listCollection<T = unknown>(collection: string): Promise<readonly T[]> {
    const prefix = `${collection}/`;
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([, value]) => value as T);
  }

  async delete(path: DocPath): Promise<void> {
    this.docs.delete(path);
  }

  async runTransaction<T>(fn: (tx: TxContext) => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => {
      const prev = this.chain;
      this.chain = new Promise<void>((r) => {
        release = r;
      });
      void prev.then(() => resolve());
    });
    await acquired;
    try {
      let attempt = 0;
      while (attempt < 8) {
        attempt += 1;
        const reads = new Map<string, unknown>();
        const writes = new Map<string, unknown>();
        const deleted = new Set<string>();

        const tx: TxContext = {
          get: async <U>(path: DocPath) => {
            if (writes.has(path)) return writes.get(path) as U | undefined;
            if (deleted.has(path)) return undefined;
            if (!reads.has(path)) {
              reads.set(path, this.docs.get(path));
            }
            return reads.get(path) as U | undefined;
          },
          set: async <U>(path: DocPath, value: U) => {
            deleted.delete(path);
            writes.set(path, value);
          },
          delete: async (path: DocPath) => {
            writes.delete(path);
            deleted.add(path);
          },
        };

        const result = await fn(tx);

        let conflict = false;
        for (const [path, snapshot] of reads) {
          if (this.docs.get(path) !== snapshot) {
            conflict = true;
            break;
          }
        }
        if (conflict) continue;
        for (const path of deleted) this.docs.delete(path);
        for (const [path, value] of writes) this.docs.set(path, value);
        return result;
      }
      throw new Error("TRANSACTION_CONFLICT:max_retries");
    } finally {
      release();
    }
  }

  async probeReachability(): Promise<void> {
    await this.get(READY_PROBE_PATH);
  }

  clear(): void {
    this.docs.clear();
  }
}

export const COLLECTIONS = {
  grants: "authorityGrants",
  commitTokens: "commitTokens",
  nonces: "nonces",
  idempotency: "idempotencyRecords",
  exposure: "exposureReservations",
  economicReservations: "economicReservations",
  sideEffects: "sideEffects",
  preparedActions: "preparedActions",
  intents: "intents",
  intentStates: "intentStates",
  intentTips: "intentTips",
  provenanceNodes: "provenanceNodes",
  provenanceEdges: "provenanceEdges",
  outcomeContracts: "outcomeContracts",
  outcomeEvents: "outcomeEvents",
  resolutionCases: "resolutionCases",
  resolutionTriggers: "resolutionTriggers",
  remediationMandates: "remediationMandates",
  mandateClaims: "mandateClaims",
  approvals: "approvals",
  approvalEvents: "approvalEvents",
  learningProposals: "learningProposals",
  learningProposalEvents: "learningProposalEvents",
  learnedContext: "learnedContext",
  /** Wave 3.8: durable preference memory records (full history). */
  preferenceRecords: "preferenceRecords",
  /** Wave 3.8: tip pointer subjectId::domain::concept → active PreferenceRecord.id */
  preferenceTips: "preferenceTips",
  /** Wave 3.8: allocated anonymous demo/session profiles. */
  demoSessions: "demoSessions",
  /** Wave 4.4: (subjectType, subjectId, domain) -> active trust LearnedContext.id */
  trustSignalTips: "trustSignalTips",
  /** Wave 3.9: durable workflow rule records (full version history). */
  workflowRules: "workflowRules",
  /** Wave 3.9: tip pointer subjectId::domain::concept → active WorkflowRule.id */
  workflowRuleTips: "workflowRuleTips",
  /**
   * Wave 3.9: secondary index tipKey → { preferenceRecordIds } for evidence
   * derivation without Firestore composite queries.
   */
  preferenceEvidenceIndexes: "preferenceEvidenceIndexes",
  /** Wave 3.3: analytics export idempotency ledger (Firestore = ops truth). */
  analyticsExportLedger: "analyticsExportLedger",
  resolutionEvents: "resolutionEvents",
  evidenceEnvelopes: "evidenceArtifacts",
  evidenceClaims: "evidenceClaims",
  executionOutbox: "executionOutbox",
  semanticArtifacts: "semanticArtifacts",
  workflowIndexes: "workflowIndexes",
  authorityEvaluations: "authorityEvaluations",
  /** Wave 4.3: durable MonitoringContract rows (ALLOW_WITH_MONITORING). */
  monitoringContracts: "monitoringContracts",
  /** Wave 4.3: workflowId → MonitoringContract.id tip index. */
  monitoringWorkflowIndex: "monitoringWorkflowIndex",
  modelCalls: "modelCalls",
  workflowStageEvents: "workflowStageEvents",
  workflowStageIndexes: "workflowStageIndexes",
  modelConcurrencySlots: "modelConcurrencySlots",
  health: "_health",
} as const;

export function docPath(collection: string, id: string): DocPath {
  return `${collection}/${id}`;
}

/** Reserved connectivity probe path. Missing document is a successful read. */
export const READY_PROBE_PATH = docPath(COLLECTIONS.health, "readyz");

function isReservedSegment(segment: string): boolean {
  return segment === "" || segment === "." || segment === "..";
}

/**
 * Map logical collection/id (id may contain slashes) to Firestore collection+doc.
 * Document ids are encodeURIComponent(logicalId) so `a/b` and `a__b` cannot collide.
 */
export function firestoreRefParts(path: DocPath): {
  readonly collection: string;
  readonly id: string;
} {
  const slash = path.indexOf("/");
  if (slash <= 0) {
    throw new Error(`Invalid document path: ${path}`);
  }
  const collection = path.slice(0, slash);
  const logicalId = path.slice(slash + 1);
  if (isReservedSegment(collection) || logicalId.length === 0) {
    throw new Error(`Invalid document path: ${path}`);
  }
  const logicalSegments = logicalId.split("/");
  if (
    logicalSegments.some((segment) => isReservedSegment(segment))
  ) {
    throw new Error(`Invalid document path: ${path}`);
  }
  return { collection, id: encodeURIComponent(logicalId) };
}
