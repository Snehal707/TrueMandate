import {
  ConstraintKind,
  ErrorCode,
  err,
  ok,
  type Constraint,
  type Result,
} from "@truemandate/protocol";

export interface ConceptFamily {
  readonly canonicalConcept: string;
  readonly aliases: readonly string[];
  readonly factFamilies?: readonly ConceptFactFamily[];
  readonly defaultFactType?: string;
}

export interface ConceptFactFamily {
  readonly factType: string;
  readonly aliases: readonly string[];
}

export type ProofMechanism =
  | { readonly kind: "EVIDENCE_OBLIGATION" }
  | { readonly kind: "DETERMINISTIC_RULE"; readonly ruleId: string };

export interface ExecutionCriticalConceptRule {
  readonly canonicalConcept: string;
  readonly proofMechanism: ProofMechanism;
}

export interface ConceptContract {
  readonly conceptFamilies: readonly ConceptFamily[];
  readonly executionCriticalConceptRules: readonly ExecutionCriticalConceptRule[];
  readonly offerBackedCanonicalConcepts?: readonly string[];
}

export interface RequiredProofCoverageExpectation {
  readonly constraintId: string;
  readonly originalConcept: string;
  readonly canonicalConcept: string;
  readonly reason:
    | "PROTOCOL_REQUIRED_KIND"
    | "TEMPORAL_AUTHORITY"
    | "DOMAIN_EXECUTION_CRITICAL";
  readonly proofMechanism: ProofMechanism;
}

export interface CanonicalSemanticFact {
  readonly canonicalConcept: string;
  readonly factType: string;
  readonly factKey: string;
}

const REQUIRED_KINDS: ReadonlySet<string> = new Set<ConstraintKind>([
  ConstraintKind.HARD,
  ConstraintKind.SAFETY_CRITICAL,
  ConstraintKind.LEGAL,
  ConstraintKind.ORGANIZATIONAL_POLICY,
  ConstraintKind.FINANCIAL,
]);

export function normalizeConceptName(value: string): string {
  return value.trim().toLowerCase();
}

const APPROVAL_SUBJECT_TOKENS = new Set([
  "provider",
  "supplier",
  "vendor",
  "payee",
  "carrier",
]);

function conceptTokens(value: string): readonly string[] {
  return normalizeConceptName(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function isApprovalFactConcept(concept: string): boolean {
  const tokens = conceptTokens(concept);
  const hasApprovalToken = tokens.includes("approved") || tokens.includes("approval");
  const hasSubjectToken = tokens.some((token) => APPROVAL_SUBJECT_TOKENS.has(token));
  return hasApprovalToken && hasSubjectToken;
}

export function normalizeApprovalFactValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.approved === "boolean") return record.approved;
    if ("status" in record) return normalizeApprovalFactValue(record.status);
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = normalizeConceptName(value).replace(/\s+/g, " ");
  if (normalized === "true" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "no") return false;
  if (
    normalized.includes("not approved") ||
    normalized.includes("unapproved") ||
    normalized.includes("approval denied") ||
    normalized.includes("approval rejected")
  ) {
    return false;
  }
  if (normalized.includes("approved") || normalized.includes("approval")) {
    return true;
  }
  return undefined;
}

const APPROVAL_SUBJECT_KEYS = [
  "provider",
  "supplier",
  "vendor",
  "payee",
  "carrier",
  "merchant",
  "subject",
  "name",
  "id",
] as const;

export function normalizeApprovalFactSubject(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeApprovalFactValue(value) === undefined
      ? normalizeConceptName(value)
      : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of APPROVAL_SUBJECT_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return normalizeConceptName(candidate);
    }
  }
  return undefined;
}

export function evaluateApprovalFactSatisfaction(
  expected: unknown,
  actual: unknown,
): "SATISFIED" | "UNSATISFIED" | "UNKNOWN" {
  const expectedApproval = normalizeApprovalFactValue(expected);
  const actualApproval = normalizeApprovalFactValue(actual);
  const expectedSubject = normalizeApprovalFactSubject(expected);
  const actualSubject = normalizeApprovalFactSubject(actual);
  const requiredApproval =
    expectedApproval ?? (expectedSubject !== undefined ? true : undefined);

  if (actualApproval === undefined) return "UNKNOWN";
  if (requiredApproval !== undefined && actualApproval !== requiredApproval) {
    return "UNSATISFIED";
  }
  if (expectedSubject !== undefined) {
    if (actualSubject === undefined) return "UNKNOWN";
    return actualSubject === expectedSubject ? "SATISFIED" : "UNSATISFIED";
  }
  return requiredApproval !== undefined ? "SATISFIED" : "UNKNOWN";
}

export function isRefundabilityFactConcept(concept: string): boolean {
  const tokens = conceptTokens(concept);
  return (
    tokens.includes("refund") ||
    tokens.includes("refundable") ||
    tokens.includes("refundability") ||
    (tokens.includes("cancellation") && tokens.includes("policy"))
  );
}

export function normalizeRefundabilityFactValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.refundable === "boolean") return record.refundable;
    if (typeof record.refundability === "boolean") return record.refundability;
    if ("cancellationPolicy" in record) {
      return normalizeRefundabilityFactValue(record.cancellationPolicy);
    }
    if ("status" in record) return normalizeRefundabilityFactValue(record.status);
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = normalizeConceptName(value).replace(/\s+/g, " ");
  if (normalized === "true" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "no") return false;
  if (
    normalized.includes("non refundable") ||
    normalized.includes("non-refundable") ||
    normalized.includes("not refundable") ||
    normalized.includes("no refund")
  ) {
    return false;
  }
  if (
    normalized.includes("refundable") ||
    normalized.includes("free cancellation") ||
    normalized.includes("cancellable")
  ) {
    return true;
  }
  return undefined;
}

function aliasIndex(
  families: readonly ConceptFamily[],
): Result<ReadonlyMap<string, string>> {
  const aliases = new Map<string, string>();
  for (const family of families) {
    const canonical = normalizeConceptName(family.canonicalConcept);
    if (!canonical) {
      return err(ErrorCode.VALIDATION_FAILED, "Canonical concept cannot be empty");
    }
    for (const rawAlias of [family.canonicalConcept, ...family.aliases]) {
      const alias = normalizeConceptName(rawAlias);
      if (!alias) {
        return err(ErrorCode.VALIDATION_FAILED, "Concept alias cannot be empty", {
          canonicalConcept: canonical,
        });
      }
      const existing = aliases.get(alias);
      if (existing && existing !== canonical) {
        return err(ErrorCode.VALIDATION_FAILED, "Concept alias maps to multiple canonical concepts", {
          alias,
          existingCanonicalConcept: existing,
          conflictingCanonicalConcept: canonical,
        });
      }
      aliases.set(alias, canonical);
    }
  }
  return ok(aliases);
}

function factIndex(
  families: readonly ConceptFamily[],
): Result<ReadonlyMap<string, CanonicalSemanticFact>> {
  const index = new Map<string, CanonicalSemanticFact>();
  for (const family of families) {
    const canonicalConcept = normalizeConceptName(family.canonicalConcept);
    if (!canonicalConcept) {
      return err(ErrorCode.VALIDATION_FAILED, "Canonical concept cannot be empty");
    }
    const defaultFactType = normalizeConceptName(family.defaultFactType ?? "identity");
    const register = (aliasValue: string, factTypeValue: string): Result<void> => {
      const alias = normalizeConceptName(aliasValue);
      const factType = normalizeConceptName(factTypeValue);
      if (!alias) {
        return err(ErrorCode.VALIDATION_FAILED, "Concept fact alias cannot be empty", {
          canonicalConcept,
          factType,
        });
      }
      if (!factType) {
        return err(ErrorCode.VALIDATION_FAILED, "Concept fact type cannot be empty", {
          canonicalConcept,
        });
      }
      const next = {
        canonicalConcept,
        factType,
        factKey: `${canonicalConcept}.${factType}`,
      } satisfies CanonicalSemanticFact;
      const existing = index.get(alias);
      if (
        existing &&
        (existing.canonicalConcept !== next.canonicalConcept || existing.factType !== next.factType)
      ) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Concept fact alias maps to multiple semantic facts",
          {
            alias,
            existingFactKey: existing.factKey,
            conflictingFactKey: next.factKey,
          },
        );
      }
      index.set(alias, next);
      return ok(undefined);
    };

    const factAliasOverrides = new Set(
      (family.factFamilies ?? [])
        .flatMap((factFamily) => factFamily.aliases)
        .map((aliasValue) => normalizeConceptName(aliasValue)),
    );
    for (const aliasValue of [family.canonicalConcept, ...family.aliases]) {
      if (factAliasOverrides.has(normalizeConceptName(aliasValue))) {
        continue;
      }
      const registered = register(aliasValue, defaultFactType);
      if (!registered.ok) return registered;
    }
    for (const factFamily of family.factFamilies ?? []) {
      for (const aliasValue of factFamily.aliases) {
        const registered = register(aliasValue, factFamily.factType);
        if (!registered.ok) return registered;
      }
    }
  }
  return ok(index);
}

export function validateConceptContract(contract: ConceptContract): Result<void> {
  const index = aliasIndex(contract.conceptFamilies);
  if (!index.ok) return index;
  const facts = factIndex(contract.conceptFamilies);
  if (!facts.ok) return facts;
  const canonical = new Set(
    contract.conceptFamilies.map((family) => normalizeConceptName(family.canonicalConcept)),
  );
  for (const family of contract.conceptFamilies) {
    const familyAliases = new Set(
      [family.canonicalConcept, ...family.aliases].map((value) => normalizeConceptName(value)),
    );
    for (const factFamily of family.factFamilies ?? []) {
      const factType = normalizeConceptName(factFamily.factType);
      if (!factType) {
        return err(ErrorCode.VALIDATION_FAILED, "Concept fact type cannot be empty", {
          canonicalConcept: normalizeConceptName(family.canonicalConcept),
        });
      }
      for (const alias of factFamily.aliases) {
        const normalizedAlias = normalizeConceptName(alias);
        if (!familyAliases.has(normalizedAlias)) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            "Concept fact alias must already belong to the declared family vocabulary",
            {
              canonicalConcept: normalizeConceptName(family.canonicalConcept),
              factType,
              alias: normalizedAlias,
            },
          );
        }
      }
    }
  }
  const referenced = [
    ...contract.executionCriticalConceptRules.map((rule) => rule.canonicalConcept),
    ...(contract.offerBackedCanonicalConcepts ?? []),
  ];
  for (const value of referenced) {
    const normalized = normalizeConceptName(value);
    if (!canonical.has(normalized)) {
      return err(ErrorCode.VALIDATION_FAILED, "Concept rule references an unknown canonical concept", {
        canonicalConcept: normalized,
      });
    }
  }
  const ruleIds = new Set<string>();
  for (const rule of contract.executionCriticalConceptRules) {
    const canonicalConcept = normalizeConceptName(rule.canonicalConcept);
    if (ruleIds.has(canonicalConcept)) {
      return err(ErrorCode.VALIDATION_FAILED, "Canonical concept has multiple execution-critical rules", {
        canonicalConcept,
      });
    }
    ruleIds.add(canonicalConcept);
    if (
      rule.proofMechanism.kind === "DETERMINISTIC_RULE" &&
      !rule.proofMechanism.ruleId.trim()
    ) {
      return err(ErrorCode.VALIDATION_FAILED, "Deterministic proof rule requires a ruleId", {
        canonicalConcept,
      });
    }
  }
  return ok(undefined);
}

export function resolveCanonicalConcept(
  concept: string,
  families: readonly ConceptFamily[],
): string | undefined {
  const index = aliasIndex(families);
  if (!index.ok) return undefined;
  return index.value.get(normalizeConceptName(concept));
}

function conceptImpliesApproval(
  concept: string,
  value: unknown,
): boolean {
  return isApprovalFactConcept(concept) || normalizeApprovalFactValue(value) !== undefined;
}

export function resolveCanonicalSemanticFact(
  concept: string,
  families: readonly ConceptFamily[],
  options?: { readonly value?: unknown },
): CanonicalSemanticFact | undefined {
  const canonicalConcept = resolveCanonicalConcept(concept, families);
  if (!canonicalConcept) return undefined;
  const normalizedConcept = normalizeConceptName(concept);
  const family = families.find(
    (item) => normalizeConceptName(item.canonicalConcept) === canonicalConcept,
  );
  const explicitFact = family?.factFamilies?.find((factFamily) =>
    factFamily.aliases.some((aliasValue) => normalizeConceptName(aliasValue) === normalizedConcept),
  );
  if (explicitFact) {
    const factType = normalizeConceptName(explicitFact.factType);
    return {
      canonicalConcept,
      factType,
      factKey: `${canonicalConcept}.${factType}`,
    };
  }
  const hasApprovalFactFamily = family?.factFamilies?.some(
    (factFamily) => normalizeConceptName(factFamily.factType) === "approval",
  ) ?? false;
  if (hasApprovalFactFamily && conceptImpliesApproval(concept, options?.value)) {
    return {
      canonicalConcept,
      factType: "approval",
      factKey: `${canonicalConcept}.approval`,
    };
  }
  const defaultFactType = normalizeConceptName(family?.defaultFactType ?? "identity");
  return {
    canonicalConcept,
    factType: defaultFactType,
    factKey: `${canonicalConcept}.${defaultFactType}`,
  };
}

export function executionCriticalRuleForConcept(
  concept: string,
  contract: Pick<ConceptContract, "conceptFamilies" | "executionCriticalConceptRules">,
): ExecutionCriticalConceptRule | undefined {
  const canonical = resolveCanonicalConcept(concept, contract.conceptFamilies);
  if (!canonical) return undefined;
  return contract.executionCriticalConceptRules.find(
    (rule) => normalizeConceptName(rule.canonicalConcept) === canonical,
  );
}

export function conceptIsOfferBacked(
  concept: string,
  contract: Pick<ConceptContract, "conceptFamilies" | "offerBackedCanonicalConcepts">,
): boolean {
  const canonical = resolveCanonicalConcept(concept, contract.conceptFamilies);
  return canonical !== undefined && (contract.offerBackedCanonicalConcepts ?? [])
    .some((value) => normalizeConceptName(value) === canonical);
}

function isAuthoritativeTemporal(
  constraint: Constraint,
  temporalAuthority: { readonly source?: string; readonly sourceRef?: string } | undefined,
): boolean {
  return constraint.kind === ConstraintKind.TEMPORAL &&
    temporalAuthority?.source === "EXPLICIT_HUMAN" &&
    temporalAuthority.sourceRef === constraint.id;
}

/**
 * Independently classifies the authoritative constraints that must have an
 * explicit proof mechanism. It deliberately does not call obligation
 * derivation, so an obligation-generation defect remains observable.
 */
export function classifyRequiredProofCoverage(
  constraints: readonly Constraint[],
  options: {
    readonly temporalAuthority?: { readonly source?: string; readonly sourceRef?: string };
    readonly conceptContract: Pick<ConceptContract, "conceptFamilies" | "executionCriticalConceptRules">;
  },
): RequiredProofCoverageExpectation[] {
  const required: RequiredProofCoverageExpectation[] = [];
  for (const constraint of constraints) {
    const rule = executionCriticalRuleForConcept(constraint.concept, options.conceptContract);
    const protocolRequired = REQUIRED_KINDS.has(constraint.kind);
    const temporalAuthority = isAuthoritativeTemporal(constraint, options.temporalAuthority);
    if (!rule && !protocolRequired && !temporalAuthority) continue;
    required.push({
      constraintId: constraint.id,
      originalConcept: constraint.concept,
      canonicalConcept:
        resolveCanonicalConcept(constraint.concept, options.conceptContract.conceptFamilies) ??
        normalizeConceptName(constraint.concept),
      reason: rule
        ? "DOMAIN_EXECUTION_CRITICAL"
        : temporalAuthority
          ? "TEMPORAL_AUTHORITY"
          : "PROTOCOL_REQUIRED_KIND",
      proofMechanism: rule?.proofMechanism ?? { kind: "EVIDENCE_OBLIGATION" },
    });
  }
  return required.sort((left, right) => left.constraintId.localeCompare(right.constraintId));
}
