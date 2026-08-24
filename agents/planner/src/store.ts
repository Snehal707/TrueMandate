import { PlanStatus, type PlanGraph, type PlanId } from "@truemandate/protocol";

export class InMemoryPlanStore {
  private readonly byId = new Map<string, PlanGraph>();
  private readonly byIntent = new Map<string, string[]>();

  put(plan: PlanGraph): void {
    this.byId.set(plan.id, plan);
    const list = this.byIntent.get(plan.intentId) ?? [];
    if (!list.includes(plan.id)) list.push(plan.id);
    this.byIntent.set(plan.intentId, list);
  }

  get(planId: PlanId | string): PlanGraph | undefined {
    return this.byId.get(planId);
  }

  listForIntent(intentId: string): readonly PlanGraph[] {
    return (this.byIntent.get(intentId) ?? [])
      .map((id) => this.byId.get(id)!)
      .filter(Boolean);
  }

  /** Mark prior plans for an intent STALE when IntentState tip changes. */
  markStaleForIntentState(intentId: string, currentIntentStateId: string): void {
    for (const plan of this.listForIntent(intentId)) {
      if (
        plan.intentStateId !== currentIntentStateId &&
        plan.status !== PlanStatus.STALE
      ) {
        this.byId.set(plan.id, { ...plan, status: PlanStatus.STALE });
      }
    }
  }

  updateStatus(planId: string, status: PlanStatus): void {
    const plan = this.byId.get(planId);
    if (plan) this.byId.set(planId, { ...plan, status });
  }
}
