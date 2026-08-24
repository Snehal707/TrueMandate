import { invokeJudge } from "@truemandate/guardian-core";
import type { ModelPort } from "@truemandate/model";
import {
  JudgeId,
  TaintClass,
  type ActionProposal,
  type JudgeResult,
  type ProvenanceNodeId,
} from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import {
  PROVENANCE_PROMPT_VERSION,
  PROVENANCE_SCHEMA_ID,
  PROVENANCE_SCHEMA_VERSION,
  PROVENANCE_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface ProvenanceJudgeInput {
  readonly action: ActionProposal;
  readonly actionNodeId?: ProvenanceNodeId | string;
}

export interface ProvenanceJudgeDeps {
  readonly model: ModelPort;
  readonly provenance: ProvenanceService;
  readonly modelId?: string;
  readonly requestId?: string;
}

function buildDeterministicSummary(
  provenance: ProvenanceService,
  actionNodeId?: string,
): {
  readonly nodes: readonly unknown[];
  readonly ancestors: readonly string[];
  readonly externalInfluence: readonly string[];
  readonly taintClasses: readonly string[];
  readonly instructionalTaint: boolean;
} {
  const graph = provenance.getGraph();
  const nodes = graph.listNodes().map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    trustClass: n.trustClass,
    taint: n.taint,
  }));
  if (!actionNodeId) {
    return {
      nodes,
      ancestors: [],
      externalInfluence: [],
      taintClasses: [],
      instructionalTaint: false,
    };
  }
  const ancestors = [...graph.ancestors(actionNodeId)];
  const influence = provenance.traceExternalInfluence(actionNodeId);
  const externalInfluence = influence.ok
    ? influence.value.map((n) => String(n.id))
    : [];
  const actionNode = graph.getNode(actionNodeId);
  const taintClasses = actionNode?.taint.classes ?? [];
  const ancestorTaint = ancestors.flatMap((id) => {
    const n = graph.getNode(id);
    return n?.taint.classes ?? [];
  });
  const allTaint = [...new Set([...taintClasses, ...ancestorTaint])];
  const instructionalTaint = allTaint.some(
    (c) => c === TaintClass.PROMPT_INJECTION_SUSPECTED,
  );
  return {
    nodes,
    ancestors,
    externalInfluence,
    taintClasses: allTaint,
    instructionalTaint,
  };
}

export async function runProvenanceJudge(
  input: ProvenanceJudgeInput,
  deps: ProvenanceJudgeDeps,
): Promise<JudgeResult> {
  const summary = buildDeterministicSummary(
    deps.provenance,
    input.actionNodeId ? String(input.actionNodeId) : undefined,
  );

  return invokeJudge({
    judgeId: JudgeId.PROVENANCE,
    model: deps.model,
    modelId: deps.modelId ?? "provenance-judge",
    promptVersion: PROVENANCE_PROMPT_VERSION,
    schemaId: PROVENANCE_SCHEMA_ID,
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    systemInstruction: PROVENANCE_SYSTEM_INSTRUCTION,
    userPayload: {
      action: input.action,
      provenanceSummary: summary,
    },
    requestId: deps.requestId ?? `provenance-${input.action.id}`,
  });
}
