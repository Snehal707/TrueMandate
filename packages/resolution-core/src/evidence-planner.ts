import {
  asResolutionCaseId,
  type EvidenceRequest,
  type ResolutionCaseId,
} from "@truemandate/protocol";

export interface EvidenceCandidate {
  readonly evidenceSought: string;
  readonly targetSource: string;
  readonly questionResolved: string;
  readonly hypothesesDistinguished: readonly string[];
  readonly distinguishesHypotheses: boolean;
  readonly independent: boolean;
  readonly timely: boolean;
  readonly trustworthy: number;
  readonly canChangeRemedy: boolean;
  readonly requiresAuthority: boolean;
  readonly urgency: "LOW" | "MEDIUM" | "HIGH";
  readonly estimatedCost?: number;
}

/** Heuristic information-value ranking for EvidenceRequestPlanner. */
export function rankEvidenceCandidates(
  candidates: readonly EvidenceCandidate[],
): readonly EvidenceCandidate[] {
  return [...candidates].sort((a, b) => score(b) - score(a));
}

function score(c: EvidenceCandidate): number {
  let s = 0;
  if (c.distinguishesHypotheses) s += 40;
  if (c.independent) s += 25;
  if (c.timely) s += 15;
  if (c.canChangeRemedy) s += 20;
  s += c.trustworthy * 10;
  if (c.requiresAuthority) s -= 5;
  return s;
}

export function toEvidenceRequest(
  caseId: ResolutionCaseId | string,
  candidate: EvidenceCandidate,
  now: string,
  id: string,
): EvidenceRequest {
  return {
    id,
    resolutionCaseId: asResolutionCaseId(String(caseId)),
    evidenceSought: candidate.evidenceSought,
    targetSource: candidate.targetSource,
    questionResolved: candidate.questionResolved,
    hypothesesDistinguished: candidate.hypothesesDistinguished,
    expectedInformationValue: score(candidate),
    urgency: candidate.urgency,
    estimatedCost: candidate.estimatedCost,
    requiresAuthority: candidate.requiresAuthority,
    createdAt: now,
  };
}

/** False-blame: one party's accusation alone cannot establish responsibility. */
export function accusationAloneCannotEstablish(
  supportingSources: readonly string[],
): boolean {
  const unique = new Set(supportingSources);
  return unique.size < 2;
}
