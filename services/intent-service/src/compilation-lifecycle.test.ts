import { hashCanonical } from "@truemandate/crypto";
import { SemanticLifecycle, asIntentId, type CandidateInterpretation, type SemanticVerificationResult } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { IntentService } from "./service.js";

const now = "2026-08-15T10:00:00.000Z";

async function fixture() {
  const intents = new IntentService();
  const created = await intents.createIntent({ id: "intent-compilation", principalId: "human-1", rawText: "Buy containers before 5 PM", createdAt: now });
  if (!created.ok) throw new Error(created.message);
  const candidate = {
    id: "candidate-1", intentId: created.value.id, rawIntentHash: created.value.contentHash, goal: "Buy containers",
    constraints: [{ id: "deadline", concept: "execution_deadline", operator: "REQUIRE", value: "before 5 PM", kind: "TEMPORAL", importance: 1, confidence: 1, sourceType: "HUMAN", mutability: "HUMAN_REVISABLE", meaningClass: "EXPLICIT", grounding: { sourceText: "before 5 PM", sourceSpan: { start: 15, end: 26 }, quoteExact: true }, temporalResolution: { originalExpression: "before 5 PM", resolvedValue: "2026-08-15T17:00:00.000Z", resolutionTimestamp: now, timezone: "Asia/Kolkata" } }],
    preferences: [], assumptions: [], ambiguities: [], readiness: "ACTIONABLE", lifecycle: SemanticLifecycle.COMPILED,
    compiledAt: now, modelMeta: { modelId: "fake", promptVersion: "v1", schemaId: "candidate", schemaVersion: "1", protocolVersion: "0.1", requestId: "r1", timestamp: now }, candidateHash: "a".repeat(64),
  } as unknown as CandidateInterpretation;
  const verification = { id: "verification-1", intentId: created.value.id, candidateId: candidate.id, candidateHash: candidate.candidateHash, lifecycle: SemanticLifecycle.VERIFIED, findings: [], transformations: [], criticalFailure: false, readiness: "ACTIONABLE", ambiguityClass: "A0", modelMeta: candidate.modelMeta, verifiedAt: now } as unknown as SemanticVerificationResult;
  return { intents, intent: created.value, candidate, verification };
}

describe("owner finalized compilation lifecycle", () => {
  it("creates one deterministic authoritative state for concurrent finalization", async () => {
    const { intents, intent, candidate, verification } = await fixture();
    const input = { intentId: intent.id, candidate, verification, compilationHash: hashCanonical({ candidate: candidate.candidateHash }), temporalAuthority: { executionNotAfter: "2026-08-15T17:00:00.000Z", source: "EXPLICIT_HUMAN" as const, sourceRef: "deadline" } };
    const [first, second] = await Promise.all([intents.finalizeVerifiedCompilation(input), intents.finalizeVerifiedCompilation(input)]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).toBe(second.value.id);
    expect(first.value.temporalAuthority?.executionNotAfter).toBe("2026-08-15T17:00:00.000Z");
    expect((await intents.getCurrentIntentState(intent.id)).ok).toBe(true);
  });

  it("rejects a verification rebound to a different compilation candidate", async () => {
    const { intents, intent, candidate, verification } = await fixture();
    const result = await intents.finalizeVerifiedCompilation({ intentId: intent.id, candidate, verification: { ...verification, candidateHash: "b".repeat(64) }, compilationHash: "c".repeat(64) });
    expect(result.ok).toBe(false);
  });

  it("inherits tip temporalAuthority on capability-policy createIntentState", async () => {
    const { intents, intent, candidate, verification } = await fixture();
    const finalized = await intents.finalizeVerifiedCompilation({
      intentId: intent.id,
      candidate,
      verification,
      compilationHash: hashCanonical({ candidate: candidate.candidateHash }),
      temporalAuthority: { executionNotAfter: "2026-08-15T17:00:00.000Z", source: "EXPLICIT_HUMAN" as const, sourceRef: "deadline" },
    });
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    const policy = await intents.createIntentState({
      intentId: intent.id,
      id: "state-policy-approval",
      constraints: finalized.value.constraints,
      capabilities: { execute_payment: "REQUIRE_APPROVAL" },
      createdBy: "wave1-operator",
    });
    expect(policy.ok).toBe(true);
    if (!policy.ok) return;
    expect(policy.value.capabilities?.execute_payment).toBe("REQUIRE_APPROVAL");
    expect(policy.value.temporalAuthority?.executionNotAfter).toBe("2026-08-15T17:00:00.000Z");
    expect(policy.value.temporalAuthority?.sourceRef).toBe("deadline");
    expect(policy.value.previousStateId).toBe(finalized.value.id);
  });
});
