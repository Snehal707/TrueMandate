import {
  PreferenceOrigin,
  PreferenceRecordStatus,
  type PreferenceRecord,
} from "@truemandate/protocol";

/**
 * Deterministic supersession evaluated at confirm-time only.
 *
 * Rules:
 * - no existing active → activate incoming
 * - incoming EXPLICIT_USER_INPUT → always activate, supersede existing
 * - incoming CONFIRMED_LEARNING over CONFIRMED_LEARNING → activate, supersede
 * - incoming CONFIRMED_LEARNING over EXPLICIT_USER_INPUT → do NOT activate;
 *   store incoming as SUPERSEDED (auditable; never silently overrides explicit)
 */

export interface SupersessionDecision {
  /** Whether the tip should point at the incoming record. */
  readonly activate: boolean;
  /** Incoming record with final status (+ supersedesId when activating). */
  readonly incoming: PreferenceRecord;
  /** Previous active record marked SUPERSEDED when activate=true and existed. */
  readonly previous?: PreferenceRecord;
}

export function resolveSupersession(
  existingActive: PreferenceRecord | undefined,
  incoming: PreferenceRecord,
): SupersessionDecision {
  if (!existingActive) {
    return {
      activate: true,
      incoming: {
        ...incoming,
        status: PreferenceRecordStatus.ACTIVE,
        supersedesId: undefined,
        supersededById: undefined,
      },
    };
  }

  const explicitIncoming =
    incoming.origin === PreferenceOrigin.EXPLICIT_USER_INPUT;
  const learnedIncoming =
    incoming.origin === PreferenceOrigin.CONFIRMED_LEARNING;
  const existingExplicit =
    existingActive.origin === PreferenceOrigin.EXPLICIT_USER_INPUT;
  const existingLearned =
    existingActive.origin === PreferenceOrigin.CONFIRMED_LEARNING;

  if (explicitIncoming || (learnedIncoming && existingLearned)) {
    const activated: PreferenceRecord = {
      ...incoming,
      status: PreferenceRecordStatus.ACTIVE,
      supersedesId: existingActive.id,
      supersededById: undefined,
    };
    const previous: PreferenceRecord = {
      ...existingActive,
      status: PreferenceRecordStatus.SUPERSEDED,
      supersededById: activated.id,
    };
    return { activate: true, incoming: activated, previous };
  }

  if (learnedIncoming && existingExplicit) {
    // Learned never silently overrides explicit. Keep tip on explicit;
    // store incoming as SUPERSEDED for audit (supersededById points at
    // the still-active explicit so the chain is reconstructable).
    const inactive: PreferenceRecord = {
      ...incoming,
      status: PreferenceRecordStatus.SUPERSEDED,
      supersedesId: undefined,
      supersededById: existingActive.id,
    };
    return { activate: false, incoming: inactive };
  }

  // Fallback: treat unknown origin combinations as non-activating.
  return {
    activate: false,
    incoming: {
      ...incoming,
      status: PreferenceRecordStatus.SUPERSEDED,
      supersededById: existingActive.id,
    },
  };
}
