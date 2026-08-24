import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";

/**
 * INV_028: WORKFLOW_RULE proposals must never target protected concepts,
 * must carry repeated distinct confirmed evidence (≥3), and must never mint
 * privilege. Create-time content validation only — durable WorkflowRule
 * records are written on confirm by learning-service.
 *
 * Protected-concept denylist is duplicated (not imported from preference-core /
 * workflow-rule-core) so Authority's create-time guard stays independent.
 */
export const AUTHORITY_PROTECTED_WORKFLOW_RULE_CONCEPTS: ReadonlySet<string> =
  new Set([
    "budget",
    "quantity",
    "merchant",
    "deadline",
    "capability",
    "authority",
  ]);

/** Must match workflow-rule-core MIN_WORKFLOW_RULE_EVIDENCE. */
export const AUTHORITY_MIN_WORKFLOW_RULE_EVIDENCE = 3;

export function assertWorkflowRuleCannotTargetProtectedConcept(
  concept: unknown,
): Result<void> {
  if (typeof concept !== "string" || concept.trim() === "") {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "WORKFLOW_RULE content.concept is required",
    );
  }
  const normalized = concept.trim().toLowerCase();
  if (AUTHORITY_PROTECTED_WORKFLOW_RULE_CONCEPTS.has(normalized)) {
    return err(
      ErrorCode.WORKFLOW_RULE_PROTECTED_CONCEPT,
      "Workflow rule cannot target protected concepts (budget/quantity/merchant/deadline/capability/authority)",
      { concept: normalized },
    );
  }
  return ok();
}

export function assertWorkflowRuleHasSufficientEvidence(
  evidenceRefs: unknown,
): Result<void> {
  if (!Array.isArray(evidenceRefs)) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "WORKFLOW_RULE content.evidenceRefs must be an array",
    );
  }
  const seen = new Set<string>();
  for (const ref of evidenceRefs) {
    if (typeof ref !== "string" || ref.trim() === "") {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "WORKFLOW_RULE content.evidenceRefs entries must be non-empty strings",
      );
    }
    seen.add(ref.trim());
  }
  if (seen.size < AUTHORITY_MIN_WORKFLOW_RULE_EVIDENCE) {
    return err(
      ErrorCode.WORKFLOW_RULE_INSUFFICIENT_EVIDENCE,
      `Workflow rule requires at least ${AUTHORITY_MIN_WORKFLOW_RULE_EVIDENCE} distinct confirmed evidence refs`,
      { distinctCount: seen.size, required: AUTHORITY_MIN_WORKFLOW_RULE_EVIDENCE },
    );
  }
  return ok();
}

/**
 * INV_028 create-time validation for WORKFLOW_RULE content shape.
 * Does not write WorkflowRule records — that happens only on confirm.
 */
export function assertWorkflowRuleContent(
  content: Readonly<Record<string, unknown>>,
): Result<void> {
  if (typeof content.subjectId !== "string" || content.subjectId.trim() === "") {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "WORKFLOW_RULE content.subjectId is required",
    );
  }

  const conceptCheck = assertWorkflowRuleCannotTargetProtectedConcept(
    content.concept,
  );
  if (!conceptCheck.ok) return conceptCheck;

  if (!("action" in content)) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "WORKFLOW_RULE content.action is required",
    );
  }

  const evidenceCheck = assertWorkflowRuleHasSufficientEvidence(
    content.evidenceRefs,
  );
  if (!evidenceCheck.ok) return evidenceCheck;

  if (!Array.isArray(content.basis) || content.basis.length === 0) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "WORKFLOW_RULE content.basis must be a non-empty array of strings",
    );
  }
  for (const entry of content.basis) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "WORKFLOW_RULE content.basis entries must be non-empty strings",
      );
    }
  }

  return ok();
}
