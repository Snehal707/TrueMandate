import { z } from "zod";
import {
  ErrorCode,
  err,
  ok,
  type ActionProposal,
  type Result,
  type ToolDescriptor,
} from "@truemandate/protocol";
import type { SdkCore } from "@truemandate/sdk-core";
import { defaultToolRegistry, type ToolRegistry } from "@truemandate/tool-registry";

/**
 * @truemandate/sdk-agent — the agent-developer surface.
 *
 * Truth contract: the agent SDK proposes (typed, locally validated action
 * proposals), transports (only the real sdk-core routes), and verifies
 * (tool classification + registry-owned privilege). Infrastructure
 * authorizes. There is NO public proposal-submission route and the agent SDK
 * therefore exposes NO submit / execute / pay / commit method of any kind.
 */

/** Local mirror of the protocol ActionProposal shape (strict). */
export const ActionProposalDraftSchema = z
  .object({
    id: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    agentId: z.string().min(1),
    capability: z.string().min(1),
    merchant: z.string().optional(),
    product: z.string().optional(),
    quantity: z.number().positive().optional(),
    amount: z.number().positive().optional(),
    currency: z.string().optional(),
    refundable: z.boolean().optional(),
    deliveryTerms: z.string().optional(),
    parameters: z.record(z.unknown()),
    consequenceLevel: z.string().min(1),
    createdAt: z.string().min(1),
    planId: z.string().min(1).optional(),
    planStepId: z.string().min(1).optional(),
  })
  .strict();
export type ActionProposalDraft = z.infer<typeof ActionProposalDraftSchema>;

export interface AgentSdk {
  readonly core: SdkCore;
  /** Tools the registry considers visible for the given capability decisions. */
  listVisibleTools(
    capabilities: Readonly<Partial<Record<string, string>>>,
  ): readonly ToolDescriptor[];
  /** Registry-owned classification of a tool (privilege class, economics). */
  classifyTool(toolId: string): Result<ToolDescriptor>;
  /** Invocation check: privilege and visibility come from the registry only. */
  assertInvocable(
    toolId: string,
    agentCapabilities: Readonly<Partial<Record<string, string>>>,
  ): Result<ToolDescriptor>;
  /** True for T2/T3 tools, which always require a gateway PreparedAction. */
  requiresPreparedAction(toolId: string): Result<boolean>;
  /**
   * Builds a locally validated ActionProposal OBJECT. No submission route
   * exists publicly — submission happens only inside the infrastructure
   * (agent-runtime -> gateway). This method exists so integrators can type
   * and validate what they would hand to a governed runtime.
   */
  buildActionProposal(draft: ActionProposalDraft): Result<ActionProposal>;
  /** Honest agent-facing boundary declaration. */
  readonly boundaries: {
    readonly propose: "local-validation-only";
    readonly transport: "sdk-core public routes only";
    readonly submit: false;
    readonly execute: false;
    readonly pay: false;
    readonly commit: false;
    readonly mint: false;
  };
}

export function createAgentSdk(core: SdkCore, registry: ToolRegistry = defaultToolRegistry()): AgentSdk {
  return {
    core,
    listVisibleTools: (capabilities) => registry.listVisibleTools(capabilities),
    classifyTool: (toolId) => registry.getTool(toolId),
    assertInvocable: (toolId, agentCapabilities) => registry.assertInvocable(toolId, agentCapabilities),
    requiresPreparedAction: (toolId) => {
      const tool = registry.getTool(toolId);
      if (!tool.ok) return tool;
      return ok(registry.requiresPreparedAction(tool.value));
    },
    buildActionProposal: (draft) => {
      const parsed = ActionProposalDraftSchema.safeParse(draft);
      if (!parsed.success) {
        return err(ErrorCode.SCHEMA_PARSE_FAILED, "invalid action proposal draft");
      }
      // Local object construction only — deliberately no transport call.
      return ok(parsed.data as ActionProposal);
    },
    boundaries: {
      propose: "local-validation-only",
      transport: "sdk-core public routes only",
      submit: false,
      execute: false,
      pay: false,
      commit: false,
      mint: false,
    },
  };
}
