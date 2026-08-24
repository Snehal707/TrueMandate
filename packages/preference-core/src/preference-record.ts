import { hashCanonical } from "@truemandate/crypto";
import {
  PreferenceRecordStatus,
  asHashDigest,
  asPreferenceRecordId,
  type LearningProposalId,
  type PreferenceOrigin,
  type PreferenceRecord,
  type PrincipalId,
} from "@truemandate/protocol";

/**
 * Tip key for preferenceTips collection: subjectId::domain::concept.
 * Exact-match only — no cross-domain or cross-subject fallback.
 */
export function preferenceTipKey(
  subjectId: string,
  domain: string,
  concept: string,
): string {
  return `${subjectId}::${domain}::${concept}`;
}

export interface BuildPreferenceRecordInput {
  readonly id: string;
  readonly subjectId: string;
  readonly domain: string;
  readonly concept: string;
  readonly value: unknown;
  readonly origin: PreferenceOrigin;
  readonly sourceLearningProposalId: LearningProposalId | string;
  readonly createdAt: string;
  readonly confirmedAt: string;
  readonly confirmedBy: PrincipalId | string;
}

function canonicalWithoutHash(
  value: Omit<PreferenceRecord, "contentHash">,
): Omit<PreferenceRecord, "contentHash"> {
  return value;
}

export function preferenceRecordHash(
  value: Omit<PreferenceRecord, "contentHash">,
): string {
  return hashCanonical(canonicalWithoutHash(value));
}

/**
 * Build a PreferenceRecord candidate (status ACTIVE by default; supersession
 * may rewrite status / supersedesId / supersededById before persist).
 */
export function buildPreferenceRecord(
  input: BuildPreferenceRecordInput,
): PreferenceRecord {
  const base: Omit<PreferenceRecord, "contentHash"> = {
    id: asPreferenceRecordId(input.id),
    subjectId: input.subjectId,
    domain: input.domain,
    concept: input.concept,
    value: input.value,
    origin: input.origin,
    status: PreferenceRecordStatus.ACTIVE,
    sourceLearningProposalId:
      input.sourceLearningProposalId as LearningProposalId,
    createdAt: input.createdAt,
    confirmedAt: input.confirmedAt,
    confirmedBy: input.confirmedBy as PrincipalId,
  };
  return {
    ...base,
    contentHash: asHashDigest(preferenceRecordHash(base)),
  };
}

/**
 * Recompute contentHash after supersession mutates status / lineage fields.
 */
export function withPreferenceRecordHash(
  value: Omit<PreferenceRecord, "contentHash"> & {
    readonly contentHash?: string;
  },
): PreferenceRecord {
  const { contentHash: _drop, ...canonical } = value;
  return {
    ...canonical,
    contentHash: asHashDigest(preferenceRecordHash(canonical)),
  };
}
