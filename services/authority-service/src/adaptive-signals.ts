import {
  PreferenceRecordStatus,
  WorkflowRuleStatus,
  ok,
  type LearnedContextRecord,
  type PreferenceRecord,
  type Result,
  type TrustSignal,
  type WorkflowRule,
} from "@truemandate/protocol";
import { parseTrustSignal } from "@truemandate/authority";

export interface LearningAdaptiveReadPort {
  getTrustSignal(
    subjectType: "AGENT" | "COUNTERPARTY",
    subjectId: string,
    domain: string,
  ): Promise<Result<unknown>>;
  getPreference(
    subjectId: string,
    domain: string,
    concept: string,
  ): Promise<Result<unknown>>;
  getWorkflowRule(
    subjectId: string,
    domain: string,
    concept: string,
  ): Promise<Result<unknown>>;
}

export interface AdaptiveTrustSelection {
  readonly learnedContext: LearnedContextRecord;
  readonly trustSignal: TrustSignal;
}

export interface AdaptiveSignalSelection {
  readonly agentTrust?: AdaptiveTrustSelection;
  readonly counterpartyTrust?: AdaptiveTrustSelection;
  readonly preferences: readonly PreferenceRecord[];
  readonly workflowRules: readonly WorkflowRule[];
}

function parseTrustResponse(
  raw: unknown,
  subjectType: "AGENT" | "COUNTERPARTY",
  subjectId: string,
  domain: string,
): AdaptiveTrustSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const response = raw as {
    learnedContext?: LearnedContextRecord | null;
    trustSignal?: unknown;
  };
  if (!response.learnedContext || response.learnedContext.domain !== domain) {
    return undefined;
  }
  if (
    response.learnedContext.proposalType !== "AGENT_RELIABILITY" &&
    response.learnedContext.proposalType !== "COUNTERPARTY_TRUST"
  ) {
    return undefined;
  }
  const parsedTrust = parseTrustSignal(response.trustSignal);
  if (!parsedTrust.ok) return undefined;
  if (
    parsedTrust.value.subjectType !== subjectType ||
    parsedTrust.value.subjectId !== subjectId ||
    parsedTrust.value.domain !== domain
  ) {
    return undefined;
  }
  return {
    learnedContext: response.learnedContext,
    trustSignal: parsedTrust.value,
  };
}

function parsePreferenceResponse(
  raw: unknown,
  subjectId: string,
  domain: string,
  concept: string,
): PreferenceRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const response = raw as { preference?: PreferenceRecord | null };
  const preference = response.preference ?? undefined;
  if (!preference) return undefined;
  if (
    preference.status !== PreferenceRecordStatus.ACTIVE ||
    preference.subjectId !== subjectId ||
    preference.domain !== domain ||
    preference.concept !== concept
  ) {
    return undefined;
  }
  return preference;
}

function parseWorkflowRuleResponse(
  raw: unknown,
  subjectId: string,
  domain: string,
  concept: string,
): WorkflowRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const response = raw as { workflowRule?: WorkflowRule | null };
  const workflowRule = response.workflowRule ?? undefined;
  if (!workflowRule) return undefined;
  if (
    workflowRule.status !== WorkflowRuleStatus.ACTIVE ||
    workflowRule.subjectId !== subjectId ||
    workflowRule.domain !== domain ||
    workflowRule.concept !== concept
  ) {
    return undefined;
  }
  return workflowRule;
}

export async function loadAdaptiveAuthoritySignals(
  learning: LearningAdaptiveReadPort | undefined,
  input: {
    readonly adaptiveSubjectId?: string;
    readonly agentId: string;
    readonly merchant?: string;
    readonly domain: string;
  },
): Promise<Result<AdaptiveSignalSelection>> {
  if (!learning) {
    return ok({ preferences: [], workflowRules: [] });
  }

  const [agentTrustResult, counterpartyTrustResult] = await Promise.all([
    learning.getTrustSignal("AGENT", input.agentId, input.domain),
    input.merchant
      ? learning.getTrustSignal("COUNTERPARTY", input.merchant, input.domain)
      : Promise.resolve(ok({ learnedContext: null, trustSignal: null })),
  ]);
  if (!agentTrustResult.ok) return agentTrustResult as Result<AdaptiveSignalSelection>;
  if (!counterpartyTrustResult.ok) return counterpartyTrustResult as Result<AdaptiveSignalSelection>;

  const preferences: PreferenceRecord[] = [];
  const workflowRules: WorkflowRule[] = [];
  if (input.adaptiveSubjectId) {
    for (const concept of ["refundable", "delivery_terms"] as const) {
      const [preferenceResult, workflowRuleResult] = await Promise.all([
        learning.getPreference(input.adaptiveSubjectId, input.domain, concept),
        learning.getWorkflowRule(input.adaptiveSubjectId, input.domain, concept),
      ]);
      if (!preferenceResult.ok) return preferenceResult as Result<AdaptiveSignalSelection>;
      if (!workflowRuleResult.ok) return workflowRuleResult as Result<AdaptiveSignalSelection>;
      const preference = parsePreferenceResponse(
        preferenceResult.value,
        input.adaptiveSubjectId,
        input.domain,
        concept,
      );
      if (preference) preferences.push(preference);
      const workflowRule = parseWorkflowRuleResponse(
        workflowRuleResult.value,
        input.adaptiveSubjectId,
        input.domain,
        concept,
      );
      if (workflowRule) workflowRules.push(workflowRule);
    }
  }

  return ok({
    agentTrust: parseTrustResponse(
      agentTrustResult.value,
      "AGENT",
      input.agentId,
      input.domain,
    ),
    counterpartyTrust: input.merchant
      ? parseTrustResponse(
          counterpartyTrustResult.value,
          "COUNTERPARTY",
          input.merchant,
          input.domain,
        )
      : undefined,
    preferences,
    workflowRules,
  });
}
