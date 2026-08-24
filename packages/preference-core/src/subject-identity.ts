import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";

/**
 * Wave 3.8 subject identity binding.
 *
 * Preferences are never global. Every preference belongs to an explicit
 * subjectId + domain. subjectId is derived from verified identity — never
 * trusted from arbitrary request JSON alone.
 */

export type PreferenceSubjectKind = "principal" | "demo";

export interface PreferenceSubjectResolution {
  readonly subjectId: string;
  readonly kind: PreferenceSubjectKind;
}

export function principalSubjectId(email: string): string {
  return `principal:${email.trim().toLowerCase()}`;
}

export function demoSubjectId(demoSessionId: string): string {
  return `demo:${demoSessionId}`;
}

/**
 * Allocate an opaque demo session id. Callers must persist it in the
 * demoSessions ledger before accepting it as a preference subject.
 */
export function allocateDemoSessionId(nowMs = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ds-${nowMs.toString(36)}-${rand}`;
}

/**
 * Resolve the preference subjectId for a request.
 *
 * Precedence:
 * 1. Verified caller email → principal:{email}
 * 2. Else demoSessionId that exists in the demoSessions ledger → demo:{id}
 * 3. Else fail closed
 */
export function resolvePreferenceSubjectId(input: {
  readonly callerEmail?: string;
  readonly demoSessionId?: string;
  readonly demoSessionExists?: boolean;
}): Result<PreferenceSubjectResolution> {
  const email = input.callerEmail?.trim();
  if (email) {
    return ok({
      subjectId: principalSubjectId(email),
      kind: "principal",
    });
  }

  const demoSessionId = input.demoSessionId?.trim();
  if (demoSessionId) {
    if (!input.demoSessionExists) {
      return err(
        ErrorCode.PREFERENCE_SUBJECT_MISMATCH,
        "demoSessionId is not registered in the demoSessions ledger",
        { demoSessionId },
      );
    }
    return ok({
      subjectId: demoSubjectId(demoSessionId),
      kind: "demo",
    });
  }

  return err(
    ErrorCode.PREFERENCE_SUBJECT_MISMATCH,
    "Preference subject requires verified caller identity or a registered demo session",
  );
}

/**
 * INV_027 identity bind: content.subjectId must equal the resolved subject.
 */
export function assertPreferenceSubjectMatches(
  contentSubjectId: unknown,
  expected: PreferenceSubjectResolution,
): Result<void> {
  if (typeof contentSubjectId !== "string" || contentSubjectId.trim() === "") {
    return err(
      ErrorCode.PREFERENCE_SUBJECT_MISMATCH,
      "USER_PREFERENCE content.subjectId is required",
    );
  }
  if (contentSubjectId !== expected.subjectId) {
    return err(
      ErrorCode.PREFERENCE_SUBJECT_MISMATCH,
      "USER_PREFERENCE content.subjectId must match verified caller or demo session identity",
      { expected: expected.subjectId, received: contentSubjectId },
    );
  }
  return ok();
}
