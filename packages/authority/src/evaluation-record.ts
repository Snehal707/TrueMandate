import { hashCanonical } from "@truemandate/crypto";
import { ErrorCode, err, ok, type AuthorityDecision, type CapabilityScope, type Result } from "@truemandate/protocol";
import { CapabilityScopeSchema, parseWithSchema } from "@truemandate/schemas";
import { z } from "zod";

export interface AuthorityEvaluationRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workflowId: string;
  readonly adaptiveSubjectId?: string;
  readonly workflow: { readonly id: string; readonly hash: string };
  readonly action: { readonly id: string; readonly hash: string };
  readonly guardian: { readonly id: string; readonly hash: string };
  readonly evaluatedIntentState: { readonly id: string; readonly hash: string; readonly version: number };
  readonly decision: AuthorityDecision;
  readonly scope: CapabilityScope;
  readonly capability: string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly expiresAt?: string;
  readonly materializationEligible: boolean;
  readonly materializationReason?: "MISSING_TEMPORAL_AUTHORITY" | "TEMPORAL_AUTHORITY_EXPIRED" | "PENDING_MONITORING" | "PENDING_APPROVAL" | "AUTHORITY_BLOCKED";
  readonly createdAt: string;
  readonly recordHash: string;
}

export interface EvaluationStore {
  get(id: string): Promise<Result<AuthorityEvaluationRecord | undefined>>;
  putIfAbsent(id: string, value: AuthorityEvaluationRecord): Promise<Result<boolean>>;
}

const reference = z.object({
  id: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

export const AuthorityEvaluationRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  workflowId: z.string().min(1),
  adaptiveSubjectId: z.string().min(1).optional(),
  workflow: reference,
  action: reference,
  guardian: reference,
  evaluatedIntentState: z.object({
    id: z.string().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/i),
    version: z.number().int().positive(),
  }).strict(),
  decision: z.enum(["ALLOW", "ALLOW_WITH_MONITORING", "REQUIRE_APPROVAL", "BLOCK"]),
  scope: CapabilityScopeSchema,
  capability: z.string().min(1),
  merchant: z.string().min(1).optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  materializationEligible: z.boolean(),
  materializationReason: z.enum([
    "MISSING_TEMPORAL_AUTHORITY",
    "TEMPORAL_AUTHORITY_EXPIRED",
    "PENDING_MONITORING",
    "PENDING_APPROVAL",
    "AUTHORITY_BLOCKED",
  ]).optional(),
  createdAt: z.string().datetime({ offset: true }),
  recordHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

export function evaluationHash(value: Omit<AuthorityEvaluationRecord, "recordHash">): string {
  return hashCanonical(value);
}

/** Parses a durable row and proves its canonical hash before it becomes trusted. */
export function parseAuthorityEvaluationRecord(value: unknown, label = "AuthorityEvaluationRecord"): Result<AuthorityEvaluationRecord> {
  const parsed = parseWithSchema(AuthorityEvaluationRecordSchema, value, label);
  if (!parsed.ok) return parsed as Result<AuthorityEvaluationRecord>;
  const { recordHash, ...canonical } = parsed.value;
  if (recordHash !== evaluationHash(canonical)) {
    return err(ErrorCode.VALIDATION_FAILED, `${label} canonical hash mismatch`);
  }
  return ok(parsed.value);
}

export async function createEvaluationRecord(
  store: EvaluationStore,
  input: Omit<AuthorityEvaluationRecord, "recordHash">,
): Promise<Result<AuthorityEvaluationRecord>> {
  const record: AuthorityEvaluationRecord = { ...input, recordHash: evaluationHash(input) };
  const validated = parseAuthorityEvaluationRecord(record);
  if (!validated.ok) return validated;

  const inserted = await store.putIfAbsent(record.id, record);
  if (!inserted.ok) return inserted as Result<AuthorityEvaluationRecord>;
  if (inserted.value) return ok(record);

  const existing = await store.get(record.id);
  if (!existing.ok) return existing as Result<AuthorityEvaluationRecord>;
  if (!existing.value) return err(ErrorCode.VALIDATION_FAILED, "Authority EvaluationRecord persistence race");
  return existing.value.recordHash === record.recordHash
    ? ok(existing.value)
    : err(ErrorCode.VALIDATION_FAILED, "Authority EvaluationRecord immutable conflict");
}
