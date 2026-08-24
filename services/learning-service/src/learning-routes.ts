import type {
  InternalRoute,
  InternalRouteResponse,
  VerifiedInternalCaller,
} from "@truemandate/cloud-runtime";
import { logStructured } from "@truemandate/observability/structured-log";
import {
  ErrorCode,
  PreferenceOrigin,
  type Intent,
  type IntentState,
  type LearnedContextRecord,
  type LearningProposal,
  type LearningProposalEvent,
  type LearningProposalType,
  type PreferenceRecord,
  type Result,
  type WorkflowRule,
} from "@truemandate/protocol";
import {
  confirmLearningProposal,
  createLearningProposal,
  expireLearningProposalIfPast,
  parseLearningProposal,
  parseTrustSignal,
  proposedEvent,
  rejectLearningProposal,
} from "@truemandate/authority";
import {
  allocateDemoSessionId,
  assertPreferenceSubjectMatches,
  buildPreferenceRecord,
  preferenceTipKey,
  resolvePreferenceSubjectId,
  resolveSupersession,
  withPreferenceRecordHash,
} from "@truemandate/preference-core";
import {
  buildWorkflowRule,
  deriveEvidenceFromPreferenceHistory,
  resolveRuleSupersession,
  withWorkflowRuleHash,
  workflowRuleTipKey,
} from "@truemandate/workflow-rule-core";
import { z } from "zod";

/**
 * Durable LearningProposal routes (owner: learning-service).
 *
 * Identity: decidedBy is ALWAYS the verified caller identity from the S2S
 * identity layer (route `caller`), never accepted from request JSON.
 * Privilege: these routes never mint grants, CommitTokens, or call Gateway.
 *
 * Wave 3.8: USER_PREFERENCE proposals bind content.subjectId to verified
 * caller or registered demo session; confirm writes PreferenceRecord with
 * deterministic supersession.
 *
 * Wave 3.9: WORKFLOW_RULE proposals require the same identity bind plus
 * INV_028 evidence; confirm writes versioned WorkflowRule records.
 */

export interface PreferenceTipDoc {
  readonly preferenceRecordId: string;
}

export interface DemoSessionDoc {
  readonly id: string;
  readonly createdAt: string;
}

export interface WorkflowRuleTipDoc {
  readonly workflowRuleId: string;
}

export interface TrustSignalTipDoc {
  readonly learnedContextId: string;
}

export interface PreferenceEvidenceIndexDoc {
  readonly preferenceRecordIds: readonly string[];
}

export interface LearningRoutePorts {
  readonly proposals: {
    get(id: string): Promise<LearningProposal | undefined>;
    putIfAbsent(id: string, value: LearningProposal): Promise<boolean>;
    put(id: string, value: LearningProposal): Promise<void>;
  };
  readonly events: {
    putIfAbsent(id: string, value: LearningProposalEvent): Promise<boolean>;
  };
  readonly learnedContext: {
    get(id: string): Promise<LearnedContextRecord | undefined>;
    putIfAbsent(id: string, value: LearnedContextRecord): Promise<boolean>;
  };
  /** Wave 3.8 preference memory ports (required for USER_PREFERENCE confirm). */
  readonly preferenceRecords?: {
    get(id: string): Promise<PreferenceRecord | undefined>;
    put(id: string, value: PreferenceRecord): Promise<void>;
  };
  readonly preferenceTips?: {
    get(tipKey: string): Promise<PreferenceTipDoc | undefined>;
    put(tipKey: string, value: PreferenceTipDoc): Promise<void>;
  };
  readonly demoSessions?: {
    get(id: string): Promise<DemoSessionDoc | undefined>;
    putIfAbsent(id: string, value: DemoSessionDoc): Promise<boolean>;
  };
  /** Wave 4.4 trust-signal tip keyed by subjectType::subjectId::domain. */
  readonly trustSignalTips?: {
    get(tipKey: string): Promise<TrustSignalTipDoc | undefined>;
    put(tipKey: string, value: TrustSignalTipDoc): Promise<void>;
  };
  /** Wave 3.9 workflow-rule ports (required for WORKFLOW_RULE confirm). */
  readonly workflowRules?: {
    get(id: string): Promise<WorkflowRule | undefined>;
    put(id: string, value: WorkflowRule): Promise<void>;
  };
  readonly workflowRuleTips?: {
    get(tipKey: string): Promise<WorkflowRuleTipDoc | undefined>;
    put(tipKey: string, value: WorkflowRuleTipDoc): Promise<void>;
  };
  /**
   * Wave 3.9: tipKey → preference record ids for evidence derivation.
   * Updated on USER_PREFERENCE confirm.
   */
  readonly preferenceEvidenceIndexes?: {
    get(tipKey: string): Promise<PreferenceEvidenceIndexDoc | undefined>;
    put(tipKey: string, value: PreferenceEvidenceIndexDoc): Promise<void>;
  };
  /** Optional: required only when a proposal carries targetIntentId (INV_011). */
  readonly resolveHistorical?: (
    targetIntentId: string,
  ) => Promise<Result<{ intent: Intent; state: IntentState }>>;
  readonly now?: () => string;
}

const CreateLearningSchema = z
  .object({
    id: z.string().min(1),
    principalId: z.string().min(1),
    domain: z.string().min(1),
    proposalType: z.enum([
      "USER_PREFERENCE",
      "AGENT_RELIABILITY",
      "COUNTERPARTY_TRUST",
      "WORKFLOW_RULE",
    ]),
    content: z.record(z.unknown()),
    createdAt: z.string().min(1).optional(),
    expiresAt: z.string().min(1).optional(),
    targetIntentId: z.string().min(1).optional(),
    /** Wave 3.8/3.9: anonymous demo session id (must exist in demoSessions ledger). */
    demoSessionId: z.string().min(1).optional(),
  })
  .strict();

const DecideLearningSchema = z
  .object({
    reason: z.string().max(2048).optional(),
  })
  .strict();

const EvidenceRequestSchema = z
  .object({
    subjectId: z.string().min(1),
    domain: z.string().min(1),
    concept: z.string().min(1),
  })
  .strict();

const TrustSignalSubjectTypeSchema = z.enum(["AGENT", "COUNTERPARTY"]);

function trustSignalTipKey(
  subjectType: "AGENT" | "COUNTERPARTY",
  subjectId: string,
  domain: string,
): string {
  return `${subjectType}::${subjectId}::${domain}`;
}

function fromResult<T>(result: Result<T>): InternalRouteResponse {
  if (result.ok) return { status: 200, body: result.value };
  const retryable = result.details?.retryable === true;
  return {
    status: retryable ? 503 : 400,
    body: { error: result.code, message: result.message, details: result.details },
  };
}

function requireVerifiedCaller(
  caller: VerifiedInternalCaller | undefined,
): Result<VerifiedInternalCaller> {
  if (!caller?.email) {
    return {
      ok: false,
      code: ErrorCode.VALIDATION_FAILED,
      message: "Verified caller identity required",
    };
  }
  return { ok: true, value: caller };
}

function parsePreferenceOrigin(value: unknown): PreferenceOrigin | undefined {
  if (value === PreferenceOrigin.EXPLICIT_USER_INPUT) {
    return PreferenceOrigin.EXPLICIT_USER_INPUT;
  }
  if (value === PreferenceOrigin.CONFIRMED_LEARNING) {
    return PreferenceOrigin.CONFIRMED_LEARNING;
  }
  return undefined;
}

function remapSubjectMismatch(
  result: Result<void>,
  code: typeof ErrorCode.WORKFLOW_RULE_SUBJECT_MISMATCH,
  label: string,
): Result<void> {
  if (result.ok) return result;
  if (result.code === ErrorCode.PREFERENCE_SUBJECT_MISMATCH) {
    return {
      ok: false,
      code,
      message: result.message.replace("USER_PREFERENCE", label),
      details: result.details,
    };
  }
  return result;
}

async function resolveBoundSubject(
  ports: LearningRoutePorts,
  caller: VerifiedInternalCaller | undefined,
  demoSessionId: string | undefined,
): Promise<Result<{ subjectId: string }>> {
  let demoSessionExists = false;
  if (demoSessionId) {
    if (!ports.demoSessions) {
      return {
        ok: false,
        code: ErrorCode.VALIDATION_FAILED,
        message: "demoSessions port required for demoSessionId",
      };
    }
    const session = await ports.demoSessions.get(demoSessionId);
    demoSessionExists = Boolean(session);
  }
  const subject = resolvePreferenceSubjectId({
    callerEmail: caller?.email,
    demoSessionId,
    demoSessionExists,
  });
  if (!subject.ok) return subject;
  return { ok: true, value: { subjectId: subject.value.subjectId } };
}

async function persistUserPreferenceOnConfirm(
  ports: LearningRoutePorts,
  proposal: LearningProposal,
  confirmedBy: string,
  at: string,
): Promise<Result<PreferenceRecord>> {
  if (!ports.preferenceRecords || !ports.preferenceTips) {
    return {
      ok: false,
      code: ErrorCode.VALIDATION_FAILED,
      message: "Preference memory ports required for USER_PREFERENCE confirm",
    };
  }

  const subjectId = proposal.content.subjectId;
  const concept = proposal.content.concept;
  const origin = parsePreferenceOrigin(proposal.content.origin);
  if (typeof subjectId !== "string" || typeof concept !== "string" || !origin) {
    return {
      ok: false,
      code: ErrorCode.VALIDATION_FAILED,
      message:
        "USER_PREFERENCE content must include subjectId, concept, and origin",
    };
  }

  const tipKey = preferenceTipKey(subjectId, proposal.domain, concept);
  const tip = await ports.preferenceTips.get(tipKey);
  const existingActive = tip
    ? await ports.preferenceRecords.get(tip.preferenceRecordId)
    : undefined;

  const candidate = buildPreferenceRecord({
    id: `pref-${proposal.id}`,
    subjectId,
    domain: proposal.domain,
    concept,
    value: proposal.content.value,
    origin,
    sourceLearningProposalId: proposal.id,
    createdAt: proposal.createdAt,
    confirmedAt: at,
    confirmedBy,
  });

  const decision = resolveSupersession(existingActive, candidate);
  const incoming = withPreferenceRecordHash(decision.incoming);
  await ports.preferenceRecords.put(incoming.id, incoming);

  if (decision.previous) {
    const previous = withPreferenceRecordHash(decision.previous);
    await ports.preferenceRecords.put(previous.id, previous);
  }

  if (decision.activate) {
    await ports.preferenceTips.put(tipKey, {
      preferenceRecordId: incoming.id,
    });
  }

  // Wave 3.9: append to evidence index (full history for rule derivation).
  if (ports.preferenceEvidenceIndexes) {
    const idx = await ports.preferenceEvidenceIndexes.get(tipKey);
    const ids = idx?.preferenceRecordIds ?? [];
    if (!ids.includes(incoming.id)) {
      await ports.preferenceEvidenceIndexes.put(tipKey, {
        preferenceRecordIds: [...ids, incoming.id],
      });
    }
  }

  return { ok: true, value: incoming };
}

async function persistWorkflowRuleOnConfirm(
  ports: LearningRoutePorts,
  proposal: LearningProposal,
  confirmedBy: string,
  at: string,
): Promise<Result<WorkflowRule>> {
  if (!ports.workflowRules || !ports.workflowRuleTips) {
    return {
      ok: false,
      code: ErrorCode.VALIDATION_FAILED,
      message: "Workflow rule ports required for WORKFLOW_RULE confirm",
    };
  }

  const subjectId = proposal.content.subjectId;
  const concept = proposal.content.concept;
  const evidenceRefs = proposal.content.evidenceRefs;
  const basis = proposal.content.basis;
  if (
    typeof subjectId !== "string" ||
    typeof concept !== "string" ||
    !Array.isArray(evidenceRefs) ||
    !Array.isArray(basis)
  ) {
    return {
      ok: false,
      code: ErrorCode.VALIDATION_FAILED,
      message:
        "WORKFLOW_RULE content must include subjectId, concept, evidenceRefs, and basis",
    };
  }

  const tipKey = workflowRuleTipKey(subjectId, proposal.domain, concept);
  const tip = await ports.workflowRuleTips.get(tipKey);
  const existingActive = tip
    ? await ports.workflowRules.get(tip.workflowRuleId)
    : undefined;

  const candidate = buildWorkflowRule({
    id: `wr-${proposal.id}`,
    subjectId,
    domain: proposal.domain,
    concept,
    action: proposal.content.action,
    evidenceRefs: evidenceRefs.map(String),
    basis: basis.map(String),
    sourceLearningProposalId: proposal.id,
    createdAt: proposal.createdAt,
    confirmedAt: at,
    confirmedBy,
  });

  const decision = resolveRuleSupersession(existingActive, candidate);
  const incoming = withWorkflowRuleHash(decision.incoming);
  await ports.workflowRules.put(incoming.id, incoming);

  if (decision.previous) {
    const previous = withWorkflowRuleHash(decision.previous);
    await ports.workflowRules.put(previous.id, previous);
  }

  if (decision.activate) {
    await ports.workflowRuleTips.put(tipKey, {
      workflowRuleId: incoming.id,
    });
  }

  return { ok: true, value: incoming };
}

export function createLearningRoutes(
  ports: LearningRoutePorts,
): readonly InternalRoute[] {
  const now = () => ports.now?.() ?? new Date().toISOString();

  return [
    {
      method: "POST",
      pattern: "/internal/demo-sessions",
      handler: async (): Promise<InternalRouteResponse> => {
        if (!ports.demoSessions) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "demoSessions port is not configured",
            },
          };
        }
        const at = now();
        const id = allocateDemoSessionId(Date.parse(at) || Date.now());
        const doc: DemoSessionDoc = { id, createdAt: at };
        const inserted = await ports.demoSessions.putIfAbsent(id, doc);
        if (!inserted) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Demo session id collision; retry",
            },
          };
        }
        return {
          status: 200,
          body: {
            demoSessionId: id,
            subjectId: `demo:${id}`,
            createdAt: at,
          },
        };
      },
    },
    {
      method: "GET",
      pattern: "/internal/preferences/:subjectId/:domain/:concept",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const subjectId = params.subjectId;
        const domain = params.domain;
        const concept = params.concept;
        if (!subjectId || !domain || !concept) {
          return {
            status: 400,
            body: {
              error: "MALFORMED_JSON",
              message: "subjectId, domain, and concept are required",
            },
          };
        }
        if (!ports.preferenceRecords || !ports.preferenceTips) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Preference memory ports are not configured",
            },
          };
        }
        const tip = await ports.preferenceTips.get(
          preferenceTipKey(subjectId, domain, concept),
        );
        if (!tip) {
          return { status: 200, body: { preference: null } };
        }
        const record = await ports.preferenceRecords.get(tip.preferenceRecordId);
        return { status: 200, body: { preference: record ?? null } };
      },
    },
    {
      method: "GET",
      pattern: "/internal/workflow-rules/:subjectId/:domain/:concept",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const subjectId = params.subjectId;
        const domain = params.domain;
        const concept = params.concept;
        if (!subjectId || !domain || !concept) {
          return {
            status: 400,
            body: {
              error: "MALFORMED_JSON",
              message: "subjectId, domain, and concept are required",
            },
          };
        }
        if (!ports.workflowRules || !ports.workflowRuleTips) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Workflow rule ports are not configured",
            },
          };
        }
        const tip = await ports.workflowRuleTips.get(
          workflowRuleTipKey(subjectId, domain, concept),
        );
        if (!tip) {
          return { status: 200, body: { workflowRule: null } };
        }
        const record = await ports.workflowRules.get(tip.workflowRuleId);
        return { status: 200, body: { workflowRule: record ?? null } };
      },
    },
    {
      method: "GET",
      pattern: "/internal/trust-signals/:subjectType/:subjectId/:domain",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const subjectTypeParsed = TrustSignalSubjectTypeSchema.safeParse(
          params.subjectType,
        );
        const subjectId = params.subjectId;
        const domain = params.domain;
        if (!subjectTypeParsed.success || !subjectId || !domain) {
          return {
            status: 400,
            body: {
              error: "MALFORMED_JSON",
              message: "subjectType, subjectId, and domain are required",
            },
          };
        }
        if (!ports.trustSignalTips) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Trust signal tips are not configured",
            },
          };
        }
        const tip = await ports.trustSignalTips.get(
          trustSignalTipKey(subjectTypeParsed.data, subjectId, domain),
        );
        if (!tip) {
          return { status: 200, body: { learnedContext: null, trustSignal: null } };
        }
        const learnedContext = await ports.learnedContext.get(tip.learnedContextId);
        if (!learnedContext) {
          return { status: 200, body: { learnedContext: null, trustSignal: null } };
        }
        const parsedTrust = parseTrustSignal(learnedContext.content.trustSignal);
        if (
          !parsedTrust.ok ||
          learnedContext.domain !== domain ||
          parsedTrust.value.subjectType !== subjectTypeParsed.data ||
          parsedTrust.value.subjectId !== subjectId ||
          parsedTrust.value.domain !== domain
        ) {
          return { status: 200, body: { learnedContext: null, trustSignal: null } };
        }
        return {
          status: 200,
          body: { learnedContext, trustSignal: parsedTrust.value },
        };
      },
    },
    {
      method: "POST",
      pattern: "/internal/workflow-rules/evidence",
      handler: async ({ body }): Promise<InternalRouteResponse> => {
        const parsed = EvidenceRequestSchema.safeParse(body);
        if (!parsed.success) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: parsed.error.message },
          };
        }
        if (!ports.preferenceRecords || !ports.preferenceEvidenceIndexes) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message:
                "preferenceRecords and preferenceEvidenceIndexes ports required for evidence derivation",
            },
          };
        }
        const { subjectId, domain, concept } = parsed.data;
        const tipKey = preferenceTipKey(subjectId, domain, concept);
        const idx = await ports.preferenceEvidenceIndexes.get(tipKey);
        const ids = idx?.preferenceRecordIds ?? [];
        const records: PreferenceRecord[] = [];
        for (const id of ids) {
          const row = await ports.preferenceRecords.get(id);
          if (row) records.push(row);
        }
        const derived = deriveEvidenceFromPreferenceHistory(
          records,
          subjectId,
          domain,
          concept,
        );
        return { status: 200, body: derived };
      },
    },
    {
      method: "POST",
      pattern: "/internal/learning-proposals",
      handler: async ({ body, caller }): Promise<InternalRouteResponse> => {
        const parsed = CreateLearningSchema.safeParse(body);
        if (!parsed.success) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: parsed.error.message },
          };
        }
        const input = parsed.data;
        const at = input.createdAt ?? now();

        if (
          input.proposalType === "USER_PREFERENCE" ||
          input.proposalType === "WORKFLOW_RULE"
        ) {
          const boundSubject = await resolveBoundSubject(
            ports,
            caller,
            input.demoSessionId,
          );
          if (!boundSubject.ok) {
            if (
              input.proposalType === "WORKFLOW_RULE" &&
              boundSubject.code === ErrorCode.PREFERENCE_SUBJECT_MISMATCH
            ) {
              return fromResult({
                ok: false,
                code: ErrorCode.WORKFLOW_RULE_SUBJECT_MISMATCH,
                message: boundSubject.message.replace(
                  "Preference subject",
                  "Workflow rule subject",
                ),
                details: boundSubject.details,
              });
            }
            return fromResult(boundSubject);
          }
          const match = assertPreferenceSubjectMatches(
            input.content.subjectId,
            {
              subjectId: boundSubject.value.subjectId,
              kind: boundSubject.value.subjectId.startsWith("demo:")
                ? "demo"
                : "principal",
            },
          );
          if (!match.ok) {
            if (input.proposalType === "WORKFLOW_RULE") {
              return fromResult(
                remapSubjectMismatch(
                  match,
                  ErrorCode.WORKFLOW_RULE_SUBJECT_MISMATCH,
                  "WORKFLOW_RULE",
                ),
              );
            }
            return fromResult(match);
          }
        }

        let historical: { intent: Intent; state: IntentState } | undefined;
        if (input.targetIntentId) {
          if (!ports.resolveHistorical) {
            return {
              status: 400,
              body: {
                error: ErrorCode.VALIDATION_FAILED,
                message: "targetIntentId requires intent resolution port",
              },
            };
          }
          const resolved = await ports.resolveHistorical(input.targetIntentId);
          if (!resolved.ok) return fromResult(resolved);
          historical = resolved.value;
        }

        const created = createLearningProposal({
          draft: {
            id: input.id,
            principalId: input.principalId,
            domain: input.domain,
            proposalType: input.proposalType as LearningProposalType,
            content: input.content,
            createdAt: at,
            expiresAt: input.expiresAt,
            targetIntentId: input.targetIntentId,
          },
          historicalIntent: historical?.intent,
          historicalState: historical?.state,
        });
        if (!created.ok) return fromResult(created);

        const eventResult = proposedEvent(created.value, {
          eventId: `learning-event-${created.value.id}-proposed`,
          at,
        });
        if (!eventResult.ok) return fromResult(eventResult);

        const inserted = await ports.proposals.putIfAbsent(
          created.value.id,
          created.value,
        );
        if (!inserted) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "LearningProposal id already exists",
            },
          };
        }
        await ports.events.putIfAbsent(eventResult.value.id, eventResult.value);
        return { status: 200, body: created.value };
      },
    },
    {
      method: "POST",
      pattern: "/internal/learning-proposals/:id/confirm",
      handler: async ({ params, body, caller }): Promise<InternalRouteResponse> => {
        const proposalId = params.id;
        if (!proposalId) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: "missing proposal id" },
          };
        }
        const identity = requireVerifiedCaller(caller);
        if (!identity.ok) return fromResult(identity);

        const parsed = DecideLearningSchema.safeParse(body ?? {});
        if (!parsed.success) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: parsed.error.message },
          };
        }

        const loaded = await ports.proposals.get(proposalId);
        if (!loaded) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Unknown learning proposal",
              details: { id: proposalId },
            },
          };
        }
        const proposal = parseLearningProposal(loaded);
        if (!proposal.ok) return fromResult(proposal);

        const at = now();
        const expiry = expireLearningProposalIfPast(proposal.value, {
          eventId: `learning-event-${proposalId}-expired`,
          at,
        });
        if (!expiry.ok) return fromResult(expiry);
        if (expiry.value.updated) {
          await ports.proposals.put(expiry.value.updated.id, expiry.value.updated);
          if (expiry.value.event) {
            await ports.events.putIfAbsent(expiry.value.event.id, expiry.value.event);
          }
          return {
            status: 400,
            body: {
              error: ErrorCode.LEARNING_PROPOSAL_EXPIRED,
              message: "Learning proposal has expired",
            },
          };
        }

        let historical: { intent: Intent; state: IntentState } | undefined;
        if (proposal.value.targetIntentId) {
          if (!ports.resolveHistorical) {
            return {
              status: 400,
              body: {
                error: ErrorCode.VALIDATION_FAILED,
                message: "targetIntentId requires intent resolution port",
              },
            };
          }
          const resolved = await ports.resolveHistorical(proposal.value.targetIntentId);
          if (!resolved.ok) return fromResult(resolved);
          historical = resolved.value;
        }

        const confirmed = confirmLearningProposal(proposal.value, {
          decidedBy: identity.value.email,
          at,
          reason: parsed.data.reason,
          eventId: `learning-event-${proposalId}-confirmed`,
          historicalIntent: historical?.intent,
          historicalState: historical?.state,
        });
        if (!confirmed.ok) return fromResult(confirmed);

        await ports.proposals.put(confirmed.value.updated.id, confirmed.value.updated);
        await ports.events.putIfAbsent(confirmed.value.event.id, confirmed.value.event);
        await ports.learnedContext.putIfAbsent(
          confirmed.value.learnedContext.id,
          confirmed.value.learnedContext,
        );

        if (
          ports.trustSignalTips &&
          (proposal.value.proposalType === "AGENT_RELIABILITY" ||
            proposal.value.proposalType === "COUNTERPARTY_TRUST")
        ) {
          const parsedTrust = parseTrustSignal(
            confirmed.value.learnedContext.content.trustSignal,
          );
          if (parsedTrust.ok) {
            await ports.trustSignalTips.put(
              trustSignalTipKey(
                parsedTrust.value.subjectType,
                parsedTrust.value.subjectId,
                confirmed.value.learnedContext.domain,
              ),
              { learnedContextId: confirmed.value.learnedContext.id },
            );
          }
        }

        let preferenceRecord: PreferenceRecord | undefined;
        if (proposal.value.proposalType === "USER_PREFERENCE") {
          const pref = await persistUserPreferenceOnConfirm(
            ports,
            confirmed.value.updated,
            identity.value.email,
            at,
          );
          if (!pref.ok) return fromResult(pref);
          preferenceRecord = pref.value;
        }

        let workflowRule: WorkflowRule | undefined;
        if (proposal.value.proposalType === "WORKFLOW_RULE") {
          const rule = await persistWorkflowRuleOnConfirm(
            ports,
            confirmed.value.updated,
            identity.value.email,
            at,
          );
          if (!rule.ok) return fromResult(rule);
          workflowRule = rule.value;
        }

        logStructured("info", {
          event: "tm.learning.decision",
          service: "learning-service",
          decision: "CONFIRMED",
          learningProposalId: proposalId,
          proposalType: proposal.value.proposalType,
          domain: proposal.value.domain,
        });

        return {
          status: 200,
          body: {
            proposal: confirmed.value.updated,
            learnedContext: confirmed.value.learnedContext,
            ...(preferenceRecord ? { preferenceRecord } : {}),
            ...(workflowRule ? { workflowRule } : {}),
          },
        };
      },
    },
    {
      method: "POST",
      pattern: "/internal/learning-proposals/:id/reject",
      handler: async ({ params, body, caller }): Promise<InternalRouteResponse> => {
        const proposalId = params.id;
        if (!proposalId) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: "missing proposal id" },
          };
        }
        const identity = requireVerifiedCaller(caller);
        if (!identity.ok) return fromResult(identity);

        const parsed = DecideLearningSchema.safeParse(body ?? {});
        if (!parsed.success) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: parsed.error.message },
          };
        }

        const loaded = await ports.proposals.get(proposalId);
        if (!loaded) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Unknown learning proposal",
              details: { id: proposalId },
            },
          };
        }
        const proposal = parseLearningProposal(loaded);
        if (!proposal.ok) return fromResult(proposal);

        const at = now();
        const expiry = expireLearningProposalIfPast(proposal.value, {
          eventId: `learning-event-${proposalId}-expired`,
          at,
        });
        if (!expiry.ok) return fromResult(expiry);
        if (expiry.value.updated) {
          await ports.proposals.put(expiry.value.updated.id, expiry.value.updated);
          if (expiry.value.event) {
            await ports.events.putIfAbsent(expiry.value.event.id, expiry.value.event);
          }
          return {
            status: 400,
            body: {
              error: ErrorCode.LEARNING_PROPOSAL_EXPIRED,
              message: "Learning proposal has expired",
            },
          };
        }

        const rejected = rejectLearningProposal(proposal.value, {
          decidedBy: identity.value.email,
          at,
          reason: parsed.data.reason,
          eventId: `learning-event-${proposalId}-rejected`,
        });
        if (!rejected.ok) return fromResult(rejected);

        await ports.proposals.put(rejected.value.updated.id, rejected.value.updated);
        await ports.events.putIfAbsent(rejected.value.event.id, rejected.value.event);

        logStructured("info", {
          event: "tm.learning.decision",
          service: "learning-service",
          decision: "REJECTED",
          learningProposalId: proposalId,
          proposalType: proposal.value.proposalType,
          domain: proposal.value.domain,
        });

        return { status: 200, body: rejected.value.updated };
      },
    },
    {
      method: "GET",
      pattern: "/internal/learning-proposals/:id",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const proposalId = params.id;
        if (!proposalId) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: "missing proposal id" },
          };
        }
        const loaded = await ports.proposals.get(proposalId);
        if (!loaded) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Unknown learning proposal",
              details: { id: proposalId },
            },
          };
        }
        const parsed = parseLearningProposal(loaded);
        if (!parsed.ok) return fromResult(parsed);
        return { status: 200, body: parsed.value };
      },
    },
    {
      method: "GET",
      pattern: "/internal/learned-context/:id",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const contextId = params.id;
        if (!contextId) {
          return {
            status: 400,
            body: { error: "MALFORMED_JSON", message: "missing learned context id" },
          };
        }
        const loaded = await ports.learnedContext.get(contextId);
        if (!loaded) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Unknown learned context",
              details: { id: contextId },
            },
          };
        }
        return { status: 200, body: loaded };
      },
    },
  ];
}
