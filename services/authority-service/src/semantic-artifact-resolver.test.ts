import { describe, expect, it } from "vitest";
import { hashCanonical } from "@truemandate/crypto";
import { proofObligationId, resolveSemanticArtifactChain, resolveTemporalExecutionBound, type SemanticArtifactReference } from "./semantic-artifact-resolver.js";

type ArtifactKind = SemanticArtifactReference["kind"];
type Predecessor = { id: string; kind: ArtifactKind; contentHash: string };
type Artifact = { id: string; kind: ArtifactKind; workflowId: string; payload: Record<string, unknown>; predecessors: Predecessor[]; contentHash: string };
type Chain = { workflowId: string; stateId: string; stateHash: string; records: Artifact[] };

const obligation = { constraintId: "food-grade", verificationStep: "certificate", requiredEvidence: "certificate", enforcingService: "guardian" };

function makeChain(prefix: string, zero = false): Chain {
  const workflowId = `workflow-${prefix}`;
  const stateId = `state-${prefix}`;
  const stateHash = `state-hash-${prefix}`;
  const payload = (body: Record<string, unknown>) => ({ intentStateId: stateId, intentStateHash: stateHash, ...body });
  const make = (id: string, kind: ArtifactKind, body: Record<string, unknown>, predecessors: Predecessor[] = []): Artifact => ({ id, kind, workflowId, payload: payload(body), predecessors, contentHash: "" });
  const plan = make(`${prefix}-plan`, "PLAN", { proofObligations: zero ? [] : [obligation] });
  const verification = make(`${prefix}-verification`, "PLAN_VERIFICATION", {});
  const action = make(`${prefix}-action`, "ACTION", { requiredProofObligationIds: zero ? [] : [proofObligationId(obligation)] });
  const proof = zero ? undefined : make(`${prefix}-proof`, "PROOF", {
    schemaVersion: "1",
    proofId: `${prefix}-proof`,
    obligationId: proofObligationId(obligation),
    actionArtifactId: action.id,
    actionPayloadHash: "",
    status: "SATISFIED",
    evidenceRefs: [{ id: `evidence-${prefix}`, hash: "a".repeat(64) }],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    method: "deterministic"
  });
  const guardian = make(`${prefix}-guardian`, "GUARDIAN", { actionArtifactId: action.id, actionArtifactHash: "", evaluatedProofs: [] });
  const workflow = make(`${prefix}-workflow`, "WORKFLOW", {});
  const records = [plan, verification, action, ...(proof ? [proof] : []), guardian, workflow];
  const chain = { workflowId, stateId, stateHash, records };
  repair(chain);
  return chain;
}

function byKind(chain: Chain, kind: ArtifactKind): Artifact {
  const found = chain.records.find((record) => record.kind === kind);
  if (!found) throw new Error(`missing ${kind}`);
  return found;
}

function ref(record: Artifact): Predecessor { return { id: record.id, kind: record.kind, contentHash: record.contentHash }; }

/** Recompute owner hashes and normal immutable links while retaining an intentionally mutated semantic binding. */
function repair(chain: Chain, options: { preserveProofActionHash?: boolean; preserveGuardianProofs?: boolean; preserveGuardianActionHash?: boolean } = {}): void {
  const plan = byKind(chain, "PLAN");
  const verification = byKind(chain, "PLAN_VERIFICATION");
  const action = byKind(chain, "ACTION");
  const proofs = chain.records.filter((record) => record.kind === "PROOF");
  const guardian = byKind(chain, "GUARDIAN");
  const workflow = byKind(chain, "WORKFLOW");
  plan.contentHash = String(hashCanonical(plan.payload));
  verification.predecessors = [ref(plan)];
  verification.contentHash = String(hashCanonical(verification.payload));
  action.predecessors = [ref(plan), ref(verification)];
  action.contentHash = String(hashCanonical(action.payload));
  for (const proof of proofs) {
    proof.predecessors = [ref(action)];
    if (!options.preserveProofActionHash) proof.payload.actionPayloadHash = action.contentHash;
    proof.contentHash = String(hashCanonical(proof.payload));
  }
  guardian.predecessors = [ref(plan), ref(verification), ref(action), ...proofs.map(ref)];
  if (!options.preserveGuardianActionHash) guardian.payload.actionArtifactHash = action.contentHash;
  if (!options.preserveGuardianProofs) guardian.payload.evaluatedProofs = proofs.map((proof) => ({ id: proof.id, hash: proof.contentHash, obligationId: proof.payload.obligationId })).sort((a, b) => `${a.id}:${a.hash}`.localeCompare(`${b.id}:${b.hash}`));
  guardian.contentHash = String(hashCanonical(guardian.payload));
  workflow.predecessors = [ref(guardian)];
  workflow.contentHash = String(hashCanonical(workflow.payload));
}

function refs(chain: Chain): SemanticArtifactReference[] { return chain.records.map((record) => ({ id: record.id, hash: record.contentHash, kind: record.kind })); }
function clone(chain: Chain): Chain { return structuredClone(chain); }
async function resolveWith(chain: Chain, records = chain.records, references = refs(chain)) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return resolveSemanticArtifactChain({
    client: { getSemanticArtifact: async (id) => {
      const record = recordsById.get(id);
      return record ? { ok: true as const, value: record } : { ok: false as const, code: "VALIDATION_FAILED" as never, message: "missing" };
    } },
    workflowId: chain.workflowId,
    intentStateId: chain.stateId,
    intentStateHash: chain.stateHash,
    references
  });
}
async function expectRejected(chain: Chain, records = chain.records, references = refs(chain)) {
  const result = await resolveWith(chain, records, references);
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("value");
}

describe("semantic artifact resolver", () => {
  const temporalConstraint = {
    id: "deadline",
    concept: "completion_deadline",
    operator: "LTE",
    value: "2026-12-31",
    kind: "TEMPORAL",
    importance: 1,
    confidence: 1,
    sourceType: "HUMAN",
    mutability: "IMMUTABLE",
    meaningClass: "EXPLICIT",
  } as const;

  it("allows materialization only with a valid current temporal source", () => {
    const result = resolveTemporalExecutionBound({
      constraints: [temporalConstraint],
      temporalAuthority: {
        executionNotAfter: "2026-12-31T00:00:00.000Z",
        source: "EXPLICIT_HUMAN",
        sourceRef: "deadline",
      },
    }, "2026-08-22T00:00:00.000Z");
    expect(result.ok).toBe(true);
  });

  it.each([
    ["missing temporal authority", { constraints: [temporalConstraint] }],
    ["expired temporal authority", {
      constraints: [temporalConstraint],
      temporalAuthority: {
        executionNotAfter: "2026-01-01T00:00:00.000Z",
        source: "EXPLICIT_HUMAN" as const,
        sourceRef: "deadline",
      },
    }],
    ["invalid sourceRef", {
      constraints: [temporalConstraint],
      temporalAuthority: {
        executionNotAfter: "2026-12-31T00:00:00.000Z",
        source: "EXPLICIT_HUMAN" as const,
        sourceRef: "missing-deadline",
      },
    }],
    ["source value mismatch", {
      constraints: [{ ...temporalConstraint, value: "2027-12-31" }],
      temporalAuthority: {
        executionNotAfter: "2026-12-31T00:00:00.000Z",
        source: "EXPLICIT_HUMAN" as const,
        sourceRef: "deadline",
      },
    }],
  ])("denies materialization for %s", (_name, state) => {
    expect(resolveTemporalExecutionBound(state, "2026-08-22T00:00:00.000Z").ok).toBe(false);
  });

  it("uses one canonical production obligation identity", () => {
    expect(proofObligationId({ a: 1, b: ["x", "y"] })).toBe(proofObligationId({ b: ["x", "y"], a: 1 }));
    expect(proofObligationId({ a: 1, b: ["x", "y"] })).not.toBe(proofObligationId({ a: 2, b: ["x", "y"] }));
  });

  it.each([false, true])("accepts a canonical %s-obligation chain", async (zero) => {
    expect((await resolveWith(makeChain(zero ? "zero" : "canonical", zero))).ok).toBe(true);
  });

  it("accepts reordered Guardian proof references when their set is unchanged", async () => {
    const chain = makeChain("reordered");
    const guardian = byKind(chain, "GUARDIAN");
    guardian.payload.evaluatedProofs = [...(guardian.payload.evaluatedProofs as object[])].reverse();
    guardian.contentHash = String(hashCanonical(guardian.payload));
    byKind(chain, "WORKFLOW").predecessors = [ref(guardian)];
    byKind(chain, "WORKFLOW").contentHash = String(hashCanonical(byKind(chain, "WORKFLOW").payload));
    expect((await resolveWith(chain)).ok).toBe(true);
  });

  it("rejects recombination of individually genuine artifacts from distinct workflows", async () => {
    const left = makeChain("left"), right = makeChain("right");
    const substituted = refs(left).map((reference) => reference.kind === "GUARDIAN" ? refs(right).find((r) => r.kind === "GUARDIAN")! : reference);
    await expectRejected(left, [...left.records, ...right.records], substituted);
  });

  it.each([
    ["verification points to another Plan", (c: Chain) => { const p = byKind(c, "PLAN"); const v = byKind(c, "PLAN_VERIFICATION"); v.predecessors = [{ ...ref(p), id: "another-plan" }]; }],
    ["Action points to another Plan", (c: Chain) => { const a = byKind(c, "ACTION"); a.predecessors[0]!.id = "another-plan"; }],
    ["Action points to another verification", (c: Chain) => { const a = byKind(c, "ACTION"); a.predecessors[1]!.id = "another-verification"; }],
    ["Proof predecessor points to another Action", (c: Chain) => { byKind(c, "PROOF").predecessors[0]!.id = "another-action"; }],
    ["Workflow points to another Guardian", (c: Chain) => { byKind(c, "WORKFLOW").predecessors[0]!.id = "another-guardian"; }],
    ["artifact workflow differs", (c: Chain) => { byKind(c, "PLAN").workflowId = "foreign-workflow"; }],
    ["artifact IntentState ID differs", (c: Chain) => { byKind(c, "PLAN").payload.intentStateId = "foreign-state"; byKind(c, "PLAN").contentHash = String(hashCanonical(byKind(c, "PLAN").payload)); }],
    ["artifact IntentState hash differs", (c: Chain) => { byKind(c, "PLAN").payload.intentStateHash = "foreign-hash"; byKind(c, "PLAN").contentHash = String(hashCanonical(byKind(c, "PLAN").payload)); }],
    ["Action required obligation set differs from Plan", (c: Chain) => { byKind(c, "ACTION").payload.requiredProofObligationIds = []; repair(c, { preserveProofActionHash: false }); }],
    ["Proof names an unknown obligation", (c: Chain) => { byKind(c, "PROOF").payload.obligationId = "unknown"; repair(c); }],
    ["Proof is UNKNOWN", (c: Chain) => { byKind(c, "PROOF").payload.status = "UNKNOWN"; repair(c); }],
    ["Proof is UNSATISFIED", (c: Chain) => { byKind(c, "PROOF").payload.status = "UNSATISFIED"; repair(c); }],
    ["Proof binds another Action ID", (c: Chain) => { byKind(c, "PROOF").payload.actionArtifactId = "another-action"; repair(c); }],
    ["Proof has correct Action ID but wrong Action hash", (c: Chain) => { byKind(c, "PROOF").payload.actionPayloadHash = "b".repeat(64); repair(c, { preserveProofActionHash: true }); }],
    ["Guardian omits a required proof", (c: Chain) => { byKind(c, "GUARDIAN").payload.evaluatedProofs = []; repair(c, { preserveGuardianProofs: true }); }],
    ["Guardian proof hash differs", (c: Chain) => { const g = byKind(c, "GUARDIAN"); (g.payload.evaluatedProofs as { hash: string }[])[0]!.hash = "b".repeat(64); repair(c, { preserveGuardianProofs: true }); }]
  ])("fails closed when %s", async (_name, mutate) => {
    const chain = makeChain(`mutation-${_name.replaceAll(" ", "-")}`);
    mutate(chain);
    await expectRejected(chain);
  });

  it.each(["PLAN", "PLAN_VERIFICATION", "ACTION", "GUARDIAN", "WORKFLOW", "PROOF"] as const)("fails closed when %s is missing", async (kind) => {
    const chain = makeChain(`missing-${kind}`);
    await expectRejected(chain, chain.records.filter((record) => record.kind !== kind), refs(chain).filter((reference) => reference.kind !== kind));
  });

  it("fails closed for a malformed persisted artifact", async () => {
    const chain = makeChain("malformed");
    const action = byKind(chain, "ACTION");
    delete (action as Partial<Artifact>).predecessors;
    await expectRejected(chain);
  });

  it("rejects two independently persisted proofs for one obligation", async () => {
    const chain = makeChain("duplicate-proof");
    const proof = byKind(chain, "PROOF");
    const second = structuredClone(proof);
    second.id = "duplicate-proof-second";
    second.payload.proofId = second.id;
    chain.records.splice(chain.records.indexOf(proof) + 1, 0, second);
    repair(chain);
    await expectRejected(chain);
  });

  it("rejects a Guardian set containing a genuine substituted proof", async () => {
    const chain = makeChain("guardian-substitution");
    const other = makeChain("guardian-substitution-other");
    const guardian = byKind(chain, "GUARDIAN");
    const foreignProof = byKind(other, "PROOF");
    guardian.payload.evaluatedProofs = [{ id: foreignProof.id, hash: foreignProof.contentHash, obligationId: foreignProof.payload.obligationId }];
    repair(chain, { preserveGuardianProofs: true });
    await expectRejected(chain, [...chain.records, ...other.records]);
  });
});
