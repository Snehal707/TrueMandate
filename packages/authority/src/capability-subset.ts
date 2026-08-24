import {
  AuthorityDecision,
  ErrorCode,
  err,
  ok,
  type CapabilityScope,
  type Result,
} from "@truemandate/protocol";

export const DECISION_RANK: Record<AuthorityDecision, number> = {
  [AuthorityDecision.BLOCK]: 0,
  [AuthorityDecision.REQUIRE_APPROVAL]: 1,
  [AuthorityDecision.ALLOW_WITH_MONITORING]: 2,
  [AuthorityDecision.ALLOW]: 3,
};

function isPermissionSubset(
  child: AuthorityDecision | undefined,
  parent: AuthorityDecision | undefined,
): boolean {
  if (child === undefined) {
    return true;
  }
  const parentDecision = parent ?? AuthorityDecision.BLOCK;
  return DECISION_RANK[child] <= DECISION_RANK[parentDecision];
}

/**
 * Allow-list subset (fail-closed):
 * - Parent restricted + child undefined = broader → fail
 * - Child [] = empty allow-set (narrower) → ok when parent defined
 * - Parent unrestricted (undefined) → child may list any subset of universe
 */
function isAllowListSubset(
  child: readonly string[] | undefined,
  parent: readonly string[] | undefined,
  field: string,
): Result<void> {
  if (parent !== undefined && child === undefined) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      `Child ${field} omitted while parent is restricted (missing restriction is broader)`,
      { field },
    );
  }
  if (child === undefined) {
    return ok();
  }
  if (parent === undefined) {
    return ok();
  }
  const parentSet = new Set(parent);
  if (!child.every((item) => parentSet.has(item))) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      `Child ${field} is not a subset of parent`,
      { field },
    );
  }
  return ok();
}

function isDeniedListSuperset(
  childDenied: readonly string[] | undefined,
  parentDenied: readonly string[] | undefined,
): boolean {
  if (parentDenied === undefined || parentDenied.length === 0) {
    return true;
  }
  const childSet = new Set(childDenied ?? []);
  return parentDenied.every((item) => childSet.has(item));
}

/**
 * INV_002: ChildAuthority ⊆ ParentAuthority (fail-closed on missing restrictions).
 */
export function isCapabilityScopeSubset(
  child: CapabilityScope,
  parent: CapabilityScope,
): Result<void> {
  const childCaps = child.capabilities;
  const parentCaps = parent.capabilities;

  for (const [name, childDecision] of Object.entries(childCaps)) {
    if (childDecision === undefined) continue;
    const parentDecision = parentCaps[name];
    if (!isPermissionSubset(childDecision, parentDecision)) {
      return err(
        ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
        `Child capability '${name}' exceeds parent`,
        { capability: name, child: childDecision, parent: parentDecision },
      );
    }
  }

  if (parent.maxAmount !== undefined && child.maxAmount === undefined) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child maxAmount omitted while parent is capped (unbounded is broader)",
      { parentMaxAmount: parent.maxAmount },
    );
  }
  if (
    child.maxAmount !== undefined &&
    (parent.maxAmount === undefined || child.maxAmount > parent.maxAmount)
  ) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child maxAmount exceeds parent",
      { childMaxAmount: child.maxAmount, parentMaxAmount: parent.maxAmount },
    );
  }

  if (parent.currency !== undefined && child.currency === undefined) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child currency omitted while parent currency is fixed",
      { parentCurrency: parent.currency },
    );
  }
  if (
    child.currency !== undefined &&
    parent.currency !== undefined &&
    child.currency !== parent.currency
  ) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child currency differs from parent",
      { childCurrency: child.currency, parentCurrency: parent.currency },
    );
  }

  const merchants = isAllowListSubset(
    child.allowedMerchants,
    parent.allowedMerchants,
    "allowedMerchants",
  );
  if (!merchants.ok) return merchants;

  if (!isDeniedListSuperset(child.deniedMerchants, parent.deniedMerchants)) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child deniedMerchants must include all parent denials",
    );
  }

  const categories = isAllowListSubset(
    child.allowedCategories,
    parent.allowedCategories,
    "allowedCategories",
  );
  if (!categories.ok) return categories;

  const resources = isAllowListSubset(
    child.resourceScope,
    parent.resourceScope,
    "resourceScope",
  );
  if (!resources.ok) return resources;

  if (parent.expiresAt !== undefined && child.expiresAt === undefined) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child expiresAt omitted while parent expires (non-expiring is broader)",
      { parentExpiresAt: parent.expiresAt },
    );
  }
  if (child.expiresAt !== undefined && parent.expiresAt !== undefined) {
    if (Date.parse(child.expiresAt) > Date.parse(parent.expiresAt)) {
      return err(
        ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
        "Child expiry exceeds parent expiry",
        { childExpiresAt: child.expiresAt, parentExpiresAt: parent.expiresAt },
      );
    }
  }

  if (parent.maxDelegationDepth !== undefined && child.maxDelegationDepth === undefined) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child maxDelegationDepth omitted while parent is capped",
      { parentDepth: parent.maxDelegationDepth },
    );
  }
  if (
    child.maxDelegationDepth !== undefined &&
    (parent.maxDelegationDepth === undefined ||
      child.maxDelegationDepth > parent.maxDelegationDepth)
  ) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Child maxDelegationDepth exceeds parent",
      {
        childDepth: child.maxDelegationDepth,
        parentDepth: parent.maxDelegationDepth,
      },
    );
  }

  return ok();
}

export function validateDelegationDepth(
  currentDepth: number,
  parentScope: CapabilityScope,
): Result<void> {
  const max = parentScope.maxDelegationDepth;
  if (max !== undefined && currentDepth > max) {
    return err(
      ErrorCode.CHILD_AUTHORITY_EXCEEDS_PARENT,
      "Delegation depth exceeds parent maxDelegationDepth",
      { currentDepth, maxDelegationDepth: max },
    );
  }
  return ok();
}

/** Exported for property-test oracles. */
export function capabilityDecisionRank(decision: AuthorityDecision): number {
  return DECISION_RANK[decision];
}
