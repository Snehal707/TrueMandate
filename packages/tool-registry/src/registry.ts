import {
  ErrorCode,
  ToolPrivilegeClass,
  err,
  ok,
  type CapabilityName,
  type Result,
  type ToolDescriptor,
} from "@truemandate/protocol";

const DEFAULT_TOOLS: readonly ToolDescriptor[] = [
  {
    toolId: "catalog.search",
    adapter: "mock-catalog",
    requiredCapability: "search",
    privilegeClass: ToolPrivilegeClass.T0_READ,
    sideEffecting: false,
    economic: false,
    supportsIdempotency: false,
    reversible: true,
    materialParameterKeys: [],
    revalidateExternalState: false,
  },
  {
    toolId: "supplier.lookup",
    adapter: "mock-catalog",
    requiredCapability: "search",
    privilegeClass: ToolPrivilegeClass.T0_READ,
    sideEffecting: false,
    economic: false,
    supportsIdempotency: false,
    reversible: true,
    materialParameterKeys: [],
    revalidateExternalState: false,
  },
  {
    toolId: "evidence.retrieve",
    adapter: "mock-evidence",
    requiredCapability: "request_evidence",
    privilegeClass: ToolPrivilegeClass.T0_READ,
    sideEffecting: false,
    economic: false,
    supportsIdempotency: false,
    reversible: true,
    materialParameterKeys: [],
    revalidateExternalState: false,
  },
  {
    toolId: "payment.execute",
    adapter: "mock-payment",
    requiredCapability: "execute_payment",
    privilegeClass: ToolPrivilegeClass.T2_ECONOMIC_WRITE,
    sideEffecting: true,
    economic: true,
    supportsIdempotency: true,
    reversible: false,
    materialParameterKeys: [
      "merchant",
      "product",
      "quantity",
      "amount",
      "currency",
      "refundability",
      "deliveryTerms",
      "certificationRef",
      "sku",
    ],
    revalidateExternalState: true,
  },
  {
    toolId: "travel.book",
    adapter: "mock-payment",
    requiredCapability: "book_travel",
    privilegeClass: ToolPrivilegeClass.T2_ECONOMIC_WRITE,
    sideEffecting: true,
    economic: true,
    supportsIdempotency: true,
    reversible: false,
    materialParameterKeys: [
      "merchant",
      "product",
      "quantity",
      "amount",
      "currency",
      "refundability",
      "deliveryTerms",
      "itineraryId",
      "travelDate",
      "travelerCount",
    ],
    revalidateExternalState: true,
  },
  {
    toolId: "saas.provision",
    adapter: "mock-payment",
    requiredCapability: "manage_saas_subscription",
    privilegeClass: ToolPrivilegeClass.T2_ECONOMIC_WRITE,
    sideEffecting: true,
    economic: true,
    supportsIdempotency: true,
    reversible: false,
    materialParameterKeys: [
      "merchant",
      "product",
      "quantity",
      "amount",
      "currency",
      "planId",
      "seatCount",
      "termMonths",
      "renewalSetting",
    ],
    revalidateExternalState: true,
  },
  {
    toolId: "invoice.pay",
    adapter: "mock-payment",
    requiredCapability: "pay_invoice",
    privilegeClass: ToolPrivilegeClass.T2_ECONOMIC_WRITE,
    sideEffecting: true,
    economic: true,
    supportsIdempotency: true,
    reversible: false,
    materialParameterKeys: [
      "merchant",
      "product",
      "quantity",
      "amount",
      "currency",
      "invoiceId",
      "dueDate",
      "duplicateCheckKey",
      "remittanceReference",
    ],
    revalidateExternalState: true,
  },
  {
    toolId: "logistics.fulfill",
    adapter: "mock-payment",
    requiredCapability: "arrange_fulfillment",
    privilegeClass: ToolPrivilegeClass.T2_ECONOMIC_WRITE,
    sideEffecting: true,
    economic: true,
    supportsIdempotency: true,
    reversible: false,
    materialParameterKeys: [
      "merchant",
      "product",
      "quantity",
      "amount",
      "currency",
      "deliveryTerms",
      "destination",
      "serviceLevel",
      "shipBy",
      "fulfillCount",
    ],
    revalidateExternalState: true,
  },
  {
    toolId: "purchase.non_refundable",
    adapter: "mock-payment",
    requiredCapability: "non_refundable_purchase",
    privilegeClass: ToolPrivilegeClass.T3_HIGH_CONSEQUENCE,
    sideEffecting: true,
    economic: true,
    supportsIdempotency: true,
    reversible: false,
    materialParameterKeys: [
      "merchant",
      "product",
      "quantity",
      "amount",
      "currency",
      "refundability",
      "sku",
    ],
    revalidateExternalState: true,
  },
];

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();

  constructor(seed: readonly ToolDescriptor[] = DEFAULT_TOOLS) {
    for (const t of seed) {
      this.tools.set(t.toolId, Object.freeze({ ...t }));
    }
  }

  getTool(toolId: string): Result<ToolDescriptor> {
    const t = this.tools.get(toolId);
    if (!t) {
      return err(ErrorCode.TOOL_UNKNOWN, "Unknown tool", { toolId });
    }
    return ok(t);
  }

  listVisibleTools(
    capabilities: Readonly<Partial<Record<CapabilityName | string, string>>>,
  ): readonly ToolDescriptor[] {
    return [...this.tools.values()].filter((t) => {
      const decision = capabilities[t.requiredCapability];
      return (
        decision === "ALLOW" ||
        decision === "ALLOW_WITH_MONITORING" ||
        decision === "REQUIRE_APPROVAL"
      );
    });
  }

  /**
   * Privilege and required capability come only from the registry.
   * Agent-supplied privilegeClass is ignored (defense in depth).
   */
  assertInvocable(
    toolId: string,
    agentCapabilities: Readonly<Partial<Record<string, string>>>,
    agentClaimedPrivilege?: string,
  ): Result<ToolDescriptor> {
    const tool = this.getTool(toolId);
    if (!tool.ok) return tool;

    if (
      agentClaimedPrivilege !== undefined &&
      agentClaimedPrivilege !== tool.value.privilegeClass
    ) {
      // Agent cannot elevate; mismatch is ignored for elevation attempts
      if (
        privilegeRank(agentClaimedPrivilege) >
        privilegeRank(tool.value.privilegeClass)
      ) {
        return err(
          ErrorCode.TOOL_PRIVILEGE_DENIED,
          "Agent-supplied privilege cannot override Tool Registry",
          {
            toolId,
            registry: tool.value.privilegeClass,
            claimed: agentClaimedPrivilege,
          },
        );
      }
    }

    const decision = agentCapabilities[tool.value.requiredCapability];
    if (
      decision !== "ALLOW" &&
      decision !== "ALLOW_WITH_MONITORING" &&
      decision !== "REQUIRE_APPROVAL"
    ) {
      return err(
        ErrorCode.TOOL_NOT_VISIBLE,
        "Tool not permitted for agent capabilities",
        { toolId, requiredCapability: tool.value.requiredCapability },
      );
    }

    return ok(tool.value);
  }

  requiresPreparedAction(tool: ToolDescriptor): boolean {
    return (
      tool.privilegeClass === ToolPrivilegeClass.T2_ECONOMIC_WRITE ||
      tool.privilegeClass === ToolPrivilegeClass.T3_HIGH_CONSEQUENCE
    );
  }
}

function privilegeRank(p: string): number {
  switch (p) {
    case ToolPrivilegeClass.T0_READ:
      return 0;
    case ToolPrivilegeClass.T1_REVERSIBLE_WRITE:
      return 1;
    case ToolPrivilegeClass.T2_ECONOMIC_WRITE:
      return 2;
    case ToolPrivilegeClass.T3_HIGH_CONSEQUENCE:
      return 3;
    default:
      return -1;
  }
}

export function defaultToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
