/** Test-only in-memory EvaluationStore seam. Production startup injects cloud persistence. */
export * from "@truemandate/authority";

import type { AuthorityEvaluationRecord, EvaluationStore } from "@truemandate/authority";
import { ok, type Result } from "@truemandate/protocol";

export class InMemoryEvaluationStore implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();

  async get(id: string): Promise<Result<AuthorityEvaluationRecord | undefined>> {
    return ok(this.rows.get(id));
  }

  async putIfAbsent(id: string, value: AuthorityEvaluationRecord): Promise<Result<boolean>> {
    if (this.rows.has(id)) return ok(false);
    this.rows.set(id, value);
    return ok(true);
  }
}
