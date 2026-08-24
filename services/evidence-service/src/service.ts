import {
  ErrorCode,
  err,
  ok,
  type EvidenceClaim,
  type EvidenceEnvelope,
  type Result,
} from "@truemandate/protocol";
import {
  EvidenceClaimSchema,
  EvidenceEnvelopeSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { hashCanonical } from "@truemandate/crypto";

export interface DurableEvidenceReadPort {
  readonly envelopes?: { get(id: string): Promise<unknown | undefined> };
  readonly claims?: { get(id: string): Promise<unknown | undefined> };
}

export class EvidenceService {
  private readonly envelopes = new Map<string, EvidenceEnvelope>();
  private readonly claims = new Map<string, EvidenceClaim>();
  private readonly durable?: DurableEvidenceReadPort;

  constructor(durable?: DurableEvidenceReadPort) {
    this.durable = durable;
  }

  /** Durable owner path. The event caller must await this before publishing. */
  async persistEnvelope(
    raw: unknown,
    repository: {
      putIfAbsent(id: string, value: unknown): Promise<boolean>;
      get?(id: string): Promise<unknown | undefined>;
    },
  ): Promise<Result<EvidenceEnvelope>> {
    const parsed = parseWithSchema(EvidenceEnvelopeSchema, raw, "EvidenceEnvelope");
    if (!parsed.ok) return parsed;
    const value = parsed.value as unknown as EvidenceEnvelope;
    const existing = await repository.get?.(String(value.id));
    if (existing !== undefined) {
      const valid = parseWithSchema(
        EvidenceEnvelopeSchema,
        existing,
        "StoredEvidenceEnvelope",
      );
      if (!valid.ok || hashCanonical(valid.value) !== hashCanonical(value)) {
        return err(ErrorCode.VALIDATION_FAILED, "Evidence envelope immutable", {
          id: value.id,
        });
      }
      const replayed = valid.value as unknown as EvidenceEnvelope;
      this.envelopes.set(replayed.id, replayed);
      return ok(replayed);
    }
    const inserted = await repository.putIfAbsent(String(value.id), value);
    if (!inserted) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Evidence envelope replay unresolved",
        { id: value.id },
      );
    }
    this.envelopes.set(value.id, value);
    return ok(value);
  }

  /** Claims are append-only; contradictory claims must have distinct ids. */
  async persistClaim(
    raw: unknown,
    repository: {
      putIfAbsent(id: string, value: unknown): Promise<boolean>;
      get?(id: string): Promise<unknown | undefined>;
    },
  ): Promise<Result<EvidenceClaim>> {
    const parsed = parseWithSchema(EvidenceClaimSchema, raw, "EvidenceClaim");
    if (!parsed.ok) return parsed;
    const value = parsed.value as unknown as EvidenceClaim;
    const existing = await repository.get?.(String(value.id));
    if (existing !== undefined) {
      const valid = parseWithSchema(
        EvidenceClaimSchema,
        existing,
        "StoredEvidenceClaim",
      );
      if (!valid.ok || hashCanonical(valid.value) !== hashCanonical(value)) {
        return err(ErrorCode.VALIDATION_FAILED, "Evidence claim immutable", {
          id: value.id,
        });
      }
      const replayed = valid.value as unknown as EvidenceClaim;
      this.claims.set(replayed.id, replayed);
      return ok(replayed);
    }
    if (!this.envelopes.has(value.evidenceId)) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence envelope", {
        evidenceId: value.evidenceId,
      });
    }
    const inserted = await repository.putIfAbsent(String(value.id), value);
    if (!inserted) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Evidence claim replay unresolved",
        { id: value.id },
      );
    }
    this.claims.set(value.id, value);
    return ok(value);
  }

  putEnvelope(raw: unknown): Result<EvidenceEnvelope> {
    const parsed = parseWithSchema(EvidenceEnvelopeSchema, raw, "EvidenceEnvelope");
    if (!parsed.ok) return parsed;
    const env = parsed.value as unknown as EvidenceEnvelope;
    if (this.envelopes.has(env.id)) {
      return err(ErrorCode.VALIDATION_FAILED, "Evidence envelope immutable", {
        id: env.id,
      });
    }
    this.envelopes.set(env.id, env);
    return ok(env);
  }

  putClaim(raw: unknown): Result<EvidenceClaim> {
    const parsed = parseWithSchema(EvidenceClaimSchema, raw, "EvidenceClaim");
    if (!parsed.ok) return parsed;
    const claim = parsed.value as unknown as EvidenceClaim;
    if (!this.envelopes.has(claim.evidenceId)) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown evidence envelope", {
        evidenceId: claim.evidenceId,
      });
    }
    if (this.claims.has(claim.id)) {
      return err(ErrorCode.VALIDATION_FAILED, "Evidence claim immutable", {
        id: claim.id,
      });
    }
    this.claims.set(claim.id, claim);
    return ok(claim);
  }

  /**
   * Durable read-through: the local mirror answers first; on a miss the
   * durable owner repository is read, schema-validated, and mirrored. The
   * Evidence owner durably owns Envelope/Claim rows — reads must never be
   * memory-only after a restart.
   */
  async getEnvelope(id: string): Promise<Result<EvidenceEnvelope>> {
    const local = this.envelopes.get(id);
    if (local) return ok(local);
    if (!this.durable?.envelopes) return err(ErrorCode.VALIDATION_FAILED, "Unknown envelope", { id });
    const row = await this.durable.envelopes.get(id);
    if (row === undefined) return err(ErrorCode.VALIDATION_FAILED, "Unknown envelope", { id });
    const parsed = parseWithSchema(EvidenceEnvelopeSchema, row, "DurableEvidenceEnvelope");
    if (!parsed.ok) return parsed as Result<EvidenceEnvelope>;
    const value = parsed.value as unknown as EvidenceEnvelope;
    this.envelopes.set(id, value);
    return ok(value);
  }

  async getClaim(id: string): Promise<Result<EvidenceClaim>> {
    const local = this.claims.get(id);
    if (local) return ok(local);
    if (!this.durable?.claims) return err(ErrorCode.VALIDATION_FAILED, "Unknown claim", { id });
    const row = await this.durable.claims.get(id);
    if (row === undefined) return err(ErrorCode.VALIDATION_FAILED, "Unknown claim", { id });
    const parsed = parseWithSchema(EvidenceClaimSchema, row, "DurableEvidenceClaim");
    if (!parsed.ok) return parsed as Result<EvidenceClaim>;
    const value = parsed.value as unknown as EvidenceClaim;
    this.claims.set(id, value);
    return ok(value);
  }

  invalidateClaim(
    claimId: string,
    now: string,
    correctedByClaimId?: string,
  ): Result<EvidenceClaim> {
    const existing = this.claims.get(claimId);
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown claim", { claimId });
    }
    const updated: EvidenceClaim = {
      ...existing,
      invalidatedAt: now,
      correctedByClaimId: correctedByClaimId as EvidenceClaim["correctedByClaimId"],
    };
    this.claims.set(claimId, updated);
    return ok(updated);
  }

  assertFresh(envelopeId: string, now: string): Result<void> {
    const env = this.envelopes.get(envelopeId);
    if (!env) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown envelope", { envelopeId });
    }
    const deadline = env.freshnessDeadline ?? env.eventTime;
    if (deadline && Date.parse(now) > Date.parse(deadline)) {
      return err(ErrorCode.EVIDENCE_STALE, "Evidence past freshness deadline", {
        envelopeId,
        deadline,
        now,
      });
    }
    return ok();
  }

  /**
   * Independence: distinct lineage/origin groups required.
   * Copies of the same source (same lineageGroupId) are not independent.
   */
  assertIndependent(envelopeIds: readonly string[]): Result<void> {
    const groups = new Set<string>();
    for (const id of envelopeIds) {
      const env = this.envelopes.get(id);
      if (!env) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown envelope", { id });
      }
      const group = env.lineageGroupId ?? env.originId ?? env.contentHash;
      if (groups.has(group) && envelopeIds.length > 1) {
        return err(
          ErrorCode.EVIDENCE_NOT_INDEPENDENT,
          "Evidence envelopes share lineage/origin — not independent",
          { group, envelopeIds },
        );
      }
      groups.add(group);
    }
    return ok();
  }

  /**
   * Detect conflicting claim values for the same concept from independent sources.
   */
  detectConflict(
    concept: string,
    claimIds: readonly string[],
  ): Result<{ readonly conflicted: boolean; readonly values: readonly unknown[] }> {
    const active = claimIds
      .map((id) => this.claims.get(id))
      .filter((c): c is EvidenceClaim => !!c && !c.invalidatedAt && c.concept === concept);
    const values = active.map((c) => c.value);
    const unique = new Set(values.map((v) => JSON.stringify(v)));
    if (unique.size > 1) {
      const envIds = active.map((c) => c.evidenceId);
      const indep = this.assertIndependent(envIds);
      if (!indep.ok) {
        // Same lineage disagreement is not independent conflict — treat as stale/insufficient
        return ok({ conflicted: false, values });
      }
      return err(ErrorCode.EVIDENCE_CONFLICT, "Independent evidence claims disagree", {
        concept,
        values,
      });
    }
    return ok({ conflicted: false, values });
  }

  listClaimsForConcept(concept: string): readonly EvidenceClaim[] {
    return [...this.claims.values()].filter(
      (c) => c.concept === concept && !c.invalidatedAt,
    );
  }
}
