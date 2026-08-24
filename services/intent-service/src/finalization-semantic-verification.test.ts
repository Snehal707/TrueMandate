import { hashCanonical } from "@truemandate/crypto";
import { SemanticLifecycle, asIntentId, type CandidateInterpretation, type SemanticVerificationResult } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { IntentService, type SemanticArtifactStore } from "./service.js";

const now = "2026-08-15T10:00:00.000Z";

type Artifact = {
  readonly id: string;
  readonly intentId: string;
  readonly workflowId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly predecessors: readonly { readonly id: string; readonly kind: string; readonly contentHash: string }[];
  readonly contentHash: string;
  readonly createdAt: string;
};

function store(rows = new Map<string, Artifact>()): { rows: Map<string, Artifact>; store: SemanticArtifactStore } {
  return {
    rows,
    store: {
      putIfAbsent: async (record) => {
        if (rows.has(record.id)) return false;
        rows.set(record.id, record as Artifact);
        return true;
      },
      get: async (id) => rows.get(id),
    },
  };
}

async function fixture() {
  const { rows, store: artifacts } = store();
  const intents = new IntentService(undefined, artifacts);
  const created = await intents.createIntent({ id: "intent-semver", principalId: "human-1", rawText: "Buy containers before 5 PM", createdAt: now });
  if (!created.ok) throw new Error(created.message);
  const candidate = {
    id: "candidate-1", intentId: created.value.id, rawIntentHash: created.value.contentHash, goal: "Buy containers",
    constraints: [{ id: "deadline", concept: "execution_deadline", operator: "REQUIRE", value: "before 5 PM", kind: "TEMPORAL", importance: 1, confidence: 1, sourceType: "HUMAN", mutability: "HUMAN_REVISABLE", meaningClass: "EXPLICIT", grounding: { sourceText: "before 5 PM", sourceSpan: { start: 15, end: 26 }, quoteExact: true }, temporalResolution: { originalExpression: "before 5 PM", resolvedValue: "2026-08-15T17:00:00.000Z", resolutionTimestamp: now, timezone: "Asia/Kolkata" } }],
    preferences: [], assumptions: [], ambiguities: [], readiness: "ACTIONABLE", lifecycle: SemanticLifecycle.COMPILED,
    compiledAt: now, modelMeta: { modelId: "fake", promptVersion: "v1", schemaId: "candidate", schemaVersion: "1", protocolVersion: "0.1", requestId: "r1", timestamp: now }, candidateHash: "a".repeat(64),
  } as unknown as CandidateInterpretation;
  const verification = { id: "verification-1", intentId: created.value.id, candidateId: candidate.id, candidateHash: candidate.candidateHash, lifecycle: SemanticLifecycle.VERIFIED, findings: [], transformations: [], criticalFailure: false, readiness: "ACTIONABLE", ambiguityClass: "A0", modelMeta: candidate.modelMeta, verifiedAt: now } as unknown as SemanticVerificationResult;
  const input = {
    intentId: created.value.id,
    candidate,
    verification,
    compilationHash: hashCanonical({ candidate: candidate.candidateHash }),
    temporalAuthority: { executionNotAfter: "2026-08-15T17:00:00.000Z", source: "EXPLICIT_HUMAN" as const, sourceRef: "deadline" },
    artifactLineage: { compilationId: "compilation-1", verificationId: "verification-1", verificationHash: hashCanonical({ v: 1 }), workflowId: "wf-1" },
  };
  return { intents, rows, input, intent: created.value };
}

describe("owner SEMANTIC_VERIFICATION artifact derivation", () => {
  it("creates the immutable artifact with deterministic identity, canonical hash, and IntentState binding on successful finalization", async () => {
    const { intents, rows, input } = await fixture();
    const result = await intents.finalizeVerifiedCompilation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const artifact = rows.get(`semantic-verification-${result.value.id}`);
    expect(artifact).toBeDefined();
    if (!artifact) return;
    expect(artifact.kind).toBe("SEMANTIC_VERIFICATION");
    expect(artifact.intentId).toBe(input.intentId);
    expect(artifact.workflowId).toBe("wf-1");
    expect(artifact.contentHash).toBe(hashCanonical(artifact.payload));
    expect(artifact.predecessors).toEqual([{ id: "verification-1", kind: "COMPILATION_VERIFICATION", contentHash: input.artifactLineage.verificationHash }]);
    const payload = artifact.payload as Record<string, unknown>;
    expect(payload.intentStateId).toBe(result.value.id);
    expect(payload.intentStateHash).toBe(result.value.stateHash);
    expect(payload.intentStateVersion).toBe(result.value.version);
    expect(payload.compilationId).toBe("compilation-1");
    expect(payload.compilationHash).toBe(input.compilationHash);
    expect(payload.verificationId).toBe("verification-1");
    expect(payload.verificationHash).toBe(input.artifactLineage.verificationHash);
    expect(payload.lifecycle).toBe("VERIFIED");
    expect(payload.evaluatedAt).toBe(now);
    expect(payload.verification).toEqual(input.verification);
  });

  it("replays identical lineage idempotently without duplicate or conflict", async () => {
    const { intents, rows, input } = await fixture();
    const first = await intents.finalizeVerifiedCompilation(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const original = rows.get(`semantic-verification-${first.value.id}`);
    const second = await intents.finalizeVerifiedCompilation(input);
    expect(second.ok).toBe(true);
    expect(second.ok && second.value.id).toBe(first.value.id);
    expect(rows.size).toBe(1);
    expect(rows.get(`semantic-verification-${first.value.id}`)).toBe(original);
  });

  it("fails closed when divergent verification meaning targets the same canonical IntentState", async () => {
    const { intents, rows, input } = await fixture();
    const first = await intents.finalizeVerifiedCompilation(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const original = rows.get(`semantic-verification-${first.value.id}`);
    const divergent = await intents.finalizeVerifiedCompilation({
      ...input,
      verification: { ...input.verification, verifiedAt: "2026-08-15T11:00:00.000Z", findings: [{ code: "DIVERGENT", severity: "HIGH", message: "changed" }] } as unknown as SemanticVerificationResult,
    });
    expect(divergent.ok).toBe(false);
    expect(rows.get(`semantic-verification-${first.value.id}`)).toBe(original);
  });

  it("fails closed when the owner store is wired but artifact lineage is missing", async () => {
    const { intents, input } = await fixture();
    const { artifactLineage: _ignored, ...withoutLineage } = input;
    void _ignored;
    const result = await intents.finalizeVerifiedCompilation(withoutLineage);
    expect(result.ok).toBe(false);
  });

  it("creates no artifact when verification lineage is invalid", async () => {
    const { intents, rows, input } = await fixture();
    const invalid = await intents.finalizeVerifiedCompilation({ ...input, verification: { ...input.verification, candidateHash: "b".repeat(64) } as unknown as SemanticVerificationResult });
    expect(invalid.ok).toBe(false);
    expect(rows.size).toBe(0);
  });

  it("derives identical canonical artifacts across independent service instances", async () => {
    const a = await fixture();
    const b = await fixture();
    const first = await a.intents.finalizeVerifiedCompilation(a.input);
    const second = await b.intents.finalizeVerifiedCompilation(b.input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).toBe(second.value.id);
    const artifactA = a.rows.get(`semantic-verification-${first.value.id}`);
    const artifactB = b.rows.get(`semantic-verification-${second.value.id}`);
    expect(artifactA?.contentHash).toBe(artifactB?.contentHash);
  });
});
