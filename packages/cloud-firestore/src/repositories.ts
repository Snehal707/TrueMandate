import type {
  Intent,
  IntentId,
  IntentState,
  IntentStateId,
} from "@truemandate/protocol";
import { hashCanonical } from "@truemandate/crypto";
import { parseAuthorityEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { parseOutcomeContract, type OutcomeContractStore } from "@truemandate/outcome-core";
import { ErrorCode, err, ok, type OutcomeContract, type Result } from "@truemandate/protocol";
import { ProvenanceEdgeSchema, ProvenanceNodeSchema } from "@truemandate/schemas";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

/**
 * Intent repository port (mirrors services/intent-service IntentRepository).
 * Kept here so cloud adapters do not depend on the service package.
 */
export interface IntentRepositoryPort {
  putIntent(intent: Intent): Promise<void>;
  getIntent(id: IntentId | string): Promise<Intent | undefined>;
  putState(state: IntentState): Promise<void>;
  getState(id: IntentStateId | string): Promise<IntentState | undefined>;
  getTip(intentId: IntentId | string): Promise<IntentState | undefined>;
  setTip(intentId: IntentId | string, stateId: IntentStateId): Promise<void>;
  finalizeState(state: IntentState): Promise<IntentState>;
}

interface TipDoc {
  readonly stateId: IntentStateId;
}

export class FirestoreIntentRepository implements IntentRepositoryPort {
  constructor(private readonly store: DocumentStore) {}

  async putIntent(intent: Intent): Promise<void> {
    await this.store.set(docPath(COLLECTIONS.intents, intent.id), intent);
  }

  async getIntent(id: IntentId | string): Promise<Intent | undefined> {
    return this.store.get(docPath(COLLECTIONS.intents, String(id)));
  }

  async putState(state: IntentState): Promise<void> {
    await this.store.set(docPath(COLLECTIONS.intentStates, state.id), state);
  }

  async getState(id: IntentStateId | string): Promise<IntentState | undefined> {
    return this.store.get(docPath(COLLECTIONS.intentStates, String(id)));
  }

  async getTip(intentId: IntentId | string): Promise<IntentState | undefined> {
    const tip = await this.store.get<TipDoc>(
      docPath(COLLECTIONS.intentTips, String(intentId)),
    );
    return tip ? this.getState(tip.stateId) : undefined;
  }

  async setTip(intentId: IntentId | string, stateId: IntentStateId): Promise<void> {
    await this.store.runTransaction(async (tx) => {
      const tip: TipDoc = { stateId };
      await tx.set(docPath(COLLECTIONS.intentTips, String(intentId)), tip);
    });
  }

  async finalizeState(state: IntentState): Promise<IntentState> {
    return this.store.runTransaction(async (tx) => {
      const statePath = docPath(COLLECTIONS.intentStates, state.id);
      const existing = await tx.get<IntentState>(statePath);
      if (existing) return existing;
      const tipPath = docPath(COLLECTIONS.intentTips, String(state.intentId));
      await tx.set(statePath, state);
      await tx.set(tipPath, { stateId: state.id });
      return state;
    });
  }
}

/** Append-only provenance node/edge repository. */
export interface ProvenanceNodeRecord {
  readonly id: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface ProvenanceEdgeRecord {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

type StoredProvenanceNodeRecord = ProvenanceNodeRecord &
  Readonly<{ recordHash: string }>;
type StoredProvenanceEdgeRecord = ProvenanceEdgeRecord &
  Readonly<{ recordHash: string }>;

function nodeRecordHash(node: ProvenanceNodeRecord): string {
  return hashCanonical({
    id: node.id,
    payload: node.payload,
    createdAt: node.createdAt,
  });
}

function edgeRecordHash(edge: ProvenanceEdgeRecord): string {
  return hashCanonical({
    id: edge.id,
    fromId: edge.fromId,
    toId: edge.toId,
    payload: edge.payload,
    createdAt: edge.createdAt,
  });
}

function assertValidNodeRecord(row: unknown): ProvenanceNodeRecord {
  const stored = row as Partial<StoredProvenanceNodeRecord>;
  if (
    typeof stored.id !== "string" ||
    typeof stored.createdAt !== "string" ||
    typeof stored.recordHash !== "string" ||
    stored.recordHash !== nodeRecordHash(stored as ProvenanceNodeRecord) ||
    !ProvenanceNodeSchema.safeParse(stored.payload).success ||
    (stored.payload as { id?: unknown; createdAt?: unknown }).id !== stored.id ||
    (stored.payload as { createdAt?: unknown }).createdAt !== stored.createdAt
  ) {
    throw new Error(
      `Invalid immutable provenance node row: ${String(stored.id ?? "unknown")}`,
    );
  }
  return { id: stored.id, payload: stored.payload, createdAt: stored.createdAt };
}

function assertValidEdgeRecord(row: unknown): ProvenanceEdgeRecord {
  const stored = row as Partial<StoredProvenanceEdgeRecord>;
  if (
    typeof stored.id !== "string" ||
    typeof stored.fromId !== "string" ||
    typeof stored.toId !== "string" ||
    typeof stored.createdAt !== "string" ||
    typeof stored.recordHash !== "string" ||
    stored.recordHash !== edgeRecordHash(stored as ProvenanceEdgeRecord) ||
    !ProvenanceEdgeSchema.safeParse(stored.payload).success ||
    (stored.payload as {
      id?: unknown;
      from?: unknown;
      to?: unknown;
      createdAt?: unknown;
    }).id !== stored.id ||
    (stored.payload as { from?: unknown }).from !== stored.fromId ||
    (stored.payload as { to?: unknown }).to !== stored.toId ||
    (stored.payload as { createdAt?: unknown }).createdAt !== stored.createdAt
  ) {
    throw new Error(
      `Invalid immutable provenance edge row: ${String(stored.id ?? "unknown")}`,
    );
  }
  return {
    id: stored.id,
    fromId: stored.fromId,
    toId: stored.toId,
    payload: stored.payload,
    createdAt: stored.createdAt,
  };
}

export interface ProvenanceRepositoryPort {
  appendNode(node: ProvenanceNodeRecord): Promise<void>;
  appendEdge(edge: ProvenanceEdgeRecord): Promise<void>;
  getNode(id: string): Promise<ProvenanceNodeRecord | undefined>;
  getEdge(id: string): Promise<ProvenanceEdgeRecord | undefined>;
  listNodes(): Promise<readonly ProvenanceNodeRecord[]>;
  listEdges(): Promise<readonly ProvenanceEdgeRecord[]>;
}

export class FirestoreProvenanceRepository implements ProvenanceRepositoryPort {
  constructor(private readonly store: DocumentStore) {}

  async appendNode(node: ProvenanceNodeRecord): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.store.runTransaction(async (tx) => {
        const path = docPath(COLLECTIONS.provenanceNodes, node.id);
        const existing = await tx.get(path);
        if (existing) {
          const row = assertValidNodeRecord(existing);
          if (
            row.id !== node.id ||
            row.createdAt !== node.createdAt ||
            hashCanonical(row.payload) !== hashCanonical(node.payload)
          ) {
            throw new Error(`Divergent immutable provenance node: ${node.id}`);
          }
          return;
        }
        await tx.set(path, {
          ...node,
          recordHash: nodeRecordHash(node),
        } satisfies StoredProvenanceNodeRecord);
      });
      console.info(JSON.stringify({ event: "firestore_provenance_write", operation: "append_node", recordId: node.id, durationMs: Date.now() - startedAt, status: "COMPLETED" }));
    } catch (error) {
      const errorCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "UNKNOWN";
      console.warn(JSON.stringify({ event: "firestore_provenance_write", operation: "append_node", recordId: node.id, durationMs: Date.now() - startedAt, status: "FAILED", errorCode }));
      throw error;
    }
  }

  async appendEdge(edge: ProvenanceEdgeRecord): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.store.runTransaction(async (tx) => {
        const path = docPath(COLLECTIONS.provenanceEdges, edge.id);
        const existing = await tx.get(path);
        if (existing) {
          const row = assertValidEdgeRecord(existing);
          if (
            row.id !== edge.id ||
            row.fromId !== edge.fromId ||
            row.toId !== edge.toId ||
            row.createdAt !== edge.createdAt ||
            hashCanonical(row.payload) !== hashCanonical(edge.payload)
          ) {
            throw new Error(`Divergent immutable provenance edge: ${edge.id}`);
          }
          return;
        }
        await tx.set(path, {
          ...edge,
          recordHash: edgeRecordHash(edge),
        } satisfies StoredProvenanceEdgeRecord);
      });
      console.info(JSON.stringify({ event: "firestore_provenance_write", operation: "append_edge", recordId: edge.id, durationMs: Date.now() - startedAt, status: "COMPLETED" }));
    } catch (error) {
      const errorCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "UNKNOWN";
      console.warn(JSON.stringify({ event: "firestore_provenance_write", operation: "append_edge", recordId: edge.id, durationMs: Date.now() - startedAt, status: "FAILED", errorCode }));
      throw error;
    }
  }

  async getNode(id: string): Promise<ProvenanceNodeRecord | undefined> {
    const row = await this.store.get(docPath(COLLECTIONS.provenanceNodes, id));
    return row === undefined ? undefined : assertValidNodeRecord(row);
  }

  async getEdge(id: string): Promise<ProvenanceEdgeRecord | undefined> {
    const row = await this.store.get(docPath(COLLECTIONS.provenanceEdges, id));
    return row === undefined ? undefined : assertValidEdgeRecord(row);
  }

  async listNodes(): Promise<readonly ProvenanceNodeRecord[]> {
    const rows = await this.store.listCollection<unknown>(COLLECTIONS.provenanceNodes);
    return rows
      .filter((row) => typeof row === "object" && row !== null && "recordHash" in row)
      .map(assertValidNodeRecord);
  }

  async listEdges(): Promise<readonly ProvenanceEdgeRecord[]> {
    const rows = await this.store.listCollection<unknown>(COLLECTIONS.provenanceEdges);
    return rows
      .filter((row) => typeof row === "object" && row !== null && "recordHash" in row)
      .map(assertValidEdgeRecord);
  }
}

/** Outcome / resolution / evidence / mandate / approval repository shells. */
export interface KeyValueRepository<T> {
  put(id: string, value: T): Promise<void>;
  get(id: string): Promise<T | undefined>;
  /** Returns false if key already existed (dedupe). */
  putIfAbsent(id: string, value: T): Promise<boolean>;
  /** Whole-collection read. Callers filter; there is no index behind this. */
  list(): Promise<readonly T[]>;
}

export class FirestoreKeyValueRepository<T> implements KeyValueRepository<T> {
  constructor(
    private readonly store: DocumentStore,
    private readonly collection: string,
  ) {}

  async put(id: string, value: T): Promise<void> {
    await this.store.set(docPath(this.collection, id), value);
  }

  async get(id: string): Promise<T | undefined> {
    return this.store.get(docPath(this.collection, id));
  }

  async putIfAbsent(id: string, value: T): Promise<boolean> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(this.collection, id);
      if (await tx.get(path)) return false;
      await tx.set(path, value);
      return true;
    });
  }

  /** Whole-collection read. Callers filter; there is no index behind this. */
  async list(): Promise<readonly T[]> {
    return this.store.listCollection<T>(this.collection);
  }
}

/** Immutable outcome-definition repository. Later lifecycle transitions must
 * use a separate explicit CAS port and cannot overwrite this definition. */
export class FirestoreOutcomeContractRepository implements OutcomeContractStore {
  private readonly rows: FirestoreKeyValueRepository<unknown>;
  constructor(store: DocumentStore) { this.rows = new FirestoreKeyValueRepository(store, COLLECTIONS.outcomeContracts); }
  async get(id: string): Promise<Result<OutcomeContract | undefined>> {
    try {
      const value = await this.rows.get(id);
      return value === undefined ? ok(undefined) : parseOutcomeContract(value, "StoredOutcomeContract");
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "OutcomeContract read failed");
    }
  }
  async putIfAbsent(id: string, value: OutcomeContract): Promise<Result<boolean>> {
    const validated = parseOutcomeContract(value, "OutcomeContract");
    if (!validated.ok) return validated as Result<boolean>;
    try { return ok(await this.rows.putIfAbsent(id, value)); }
    catch { return err(ErrorCode.VALIDATION_FAILED, "OutcomeContract write failed"); }
  }
}

export function createOutcomeContractRepository(store: DocumentStore): FirestoreOutcomeContractRepository {
  return new FirestoreOutcomeContractRepository(store);
}

/** Compatibility adapter for existing lifecycle consumers. It must never be
 * used to create an authoritative pre-execution definition. */
export function createOutcomeLifecycleRepository(store: DocumentStore): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.outcomeContracts);
}

export function createOutcomeEventRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.outcomeEvents);
}

export function createResolutionCaseRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.resolutionCases);
}

export function createResolutionTriggerDedupeRepository(
  store: DocumentStore,
): KeyValueRepository<{ seenAt: string; caseId?: string }> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.resolutionTriggers);
}

export function createRemediationMandateRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(
    store,
    COLLECTIONS.remediationMandates,
  );
}

export function createApprovalRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.approvals);
}

/** Append-only approval lifecycle events (history/audit; never mutated). */
export function createApprovalEventRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.approvalEvents);
}

export function createLearningProposalRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.learningProposals);
}

/** Append-only learning proposal lifecycle events (history/audit; never mutated). */
export function createLearningProposalEventRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.learningProposalEvents);
}

/** Durable learned context written only on CONFIRMED LearningProposal. */
export function createLearnedContextRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.learnedContext);
}

/** Wave 3.8: durable preference memory records (full history retained). */
export function createPreferenceRecordRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.preferenceRecords);
}

/**
 * Wave 3.8: tip pointer keyed by subjectId::domain::concept → active PreferenceRecord.id.
 * Document shape: `{ preferenceRecordId: string }`.
 */
export function createPreferenceTipRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.preferenceTips);
}

/**
 * Wave 3.8: allocated anonymous demo/session profiles.
 * Document shape: `{ id: string, createdAt: string }`.
 */
export function createDemoSessionRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.demoSessions);
}

/**
 * Wave 4.4: tip pointer keyed by subjectType::subjectId::domain -> active
 * LearnedContextRecord.id containing a confirmed TrustSignal.
 */
export function createTrustSignalTipRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.trustSignalTips);
}

/** Wave 3.9: durable workflow rule records (full version history retained). */
export function createWorkflowRuleRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.workflowRules);
}

/**
 * Wave 3.9: tip pointer keyed by subjectId::domain::concept → active WorkflowRule.id.
 * Document shape: `{ workflowRuleId: string }`.
 */
export function createWorkflowRuleTipRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.workflowRuleTips);
}

/**
 * Wave 3.9: preference evidence index tipKey → { preferenceRecordIds: string[] }.
 * Updated on USER_PREFERENCE confirm so evidence derivation needs no composite query.
 */
export function createPreferenceEvidenceIndexRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(
    store,
    COLLECTIONS.preferenceEvidenceIndexes,
  );
}

/**
 * Wave 3.3 analytics export idempotency ledger.
 * Tracks which event/node/edge export_ids have been successfully written to BigQuery.
 * BigQuery is never read to decide whether something was already exported.
 */
export function createAnalyticsExportLedgerRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.analyticsExportLedger);
}

/** Append-only resolution lifecycle events (history/audit; never mutated). */
export function createResolutionEventRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.resolutionEvents);
}

/** Single-slot remediation mandate claims (ACTIVE → CLAIMED → RELEASED/CONSUMED). */
export function createMandateClaimRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.mandateClaims);
}

export function createEvidenceEnvelopeRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.evidenceEnvelopes);
}

export function createEvidenceClaimRepository(
  store: DocumentStore,
): KeyValueRepository<unknown> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.evidenceClaims);
}

/** Durable publication recovery for execution side effects. The side effect must
 * already be durable before an item is created; retries only republish this record. */
export interface ExecutionOutboxRecord {
  readonly id: string;
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly publishedAt?: string;
  readonly attempts: number;
}

export function createExecutionOutboxRepository(
  store: DocumentStore,
): KeyValueRepository<ExecutionOutboxRecord> {
  return new FirestoreKeyValueRepository(store, COLLECTIONS.executionOutbox);
}

/** Opaque Authority-owned evaluation records. Never caller supplied. */
export class FirestoreAuthorityEvaluationRepository implements EvaluationStore {
  private readonly rows: FirestoreKeyValueRepository<unknown>;
  constructor(store: DocumentStore) { this.rows = new FirestoreKeyValueRepository(store, COLLECTIONS.authorityEvaluations); }
  async get(id: string): Promise<Result<AuthorityEvaluationRecord | undefined>> {
    try {
      const value = await this.rows.get(id);
      if (value === undefined) return ok(undefined);
      return parseAuthorityEvaluationRecord(value, "StoredAuthorityEvaluationRecord");
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "Authority EvaluationRecord read failed");
    }
  }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord): Promise<Result<boolean>> {
    const validated = parseAuthorityEvaluationRecord(value, "AuthorityEvaluationRecord");
    if (!validated.ok) return validated as Result<boolean>;
    try {
      return ok(await this.rows.putIfAbsent(id, value));
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "Authority EvaluationRecord write failed");
    }
  }
}
export function createAuthorityEvaluationRepository(store: DocumentStore): FirestoreAuthorityEvaluationRepository { return new FirestoreAuthorityEvaluationRepository(store); }


/** Immutable semantic workflow records owned by intent/provenance. */
export interface SemanticArtifactRecord {
  readonly id: string;
  readonly intentId: string;
  readonly workflowId: string;
  readonly kind: import("@truemandate/schemas").SemanticArtifactKind;
  readonly payload: unknown;
  readonly predecessors: readonly { readonly id: string; readonly kind: string; readonly contentHash: string }[];
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface SemanticArtifactRepository {
  putIfAbsent(record: SemanticArtifactRecord): Promise<boolean>;
  get(id: string): Promise<SemanticArtifactRecord | undefined>;
  listWorkflow(workflowId: string): Promise<readonly SemanticArtifactRecord[]>;
}

export class FirestoreSemanticArtifactRepository implements SemanticArtifactRepository {
  constructor(private readonly store: DocumentStore) {}
  async putIfAbsent(record: SemanticArtifactRecord): Promise<boolean> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.semanticArtifacts, record.id);
      if (await tx.get(path)) return false;
      const idxPath = docPath(COLLECTIONS.workflowIndexes, record.workflowId);
      const idx = (await tx.get<{ ids: string[] }>(idxPath)) ?? { ids: [] };
      await tx.set(path, record);
      await tx.set(idxPath, { ids: [...idx.ids, record.id] });
      return true;
    });
  }
  async get(id: string): Promise<SemanticArtifactRecord | undefined> {
    return this.store.get(docPath(COLLECTIONS.semanticArtifacts, id));
  }
  async listWorkflow(workflowId: string): Promise<readonly SemanticArtifactRecord[]> {
    const index = await this.store.get<{ ids: string[] }>(docPath(COLLECTIONS.workflowIndexes, workflowId));
    if (!index) return [];
    const rows = await Promise.all(index.ids.map((id) => this.get(id)));
    return rows.filter((row): row is SemanticArtifactRecord => row !== undefined);
  }
}
