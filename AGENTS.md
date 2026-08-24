# Semantic Trust Runtime Project Instructions

## Primary source of truth

Before making architectural, implementation, security, protocol, agent, infrastructure, testing, or product decisions, read `docs/PROJECT_SPEC.md`.

`docs/PROJECT_SPEC.md` is the authoritative specification for what this repository is building.

Do not replace its requirements with assumptions, generic best practices, or a simpler interpretation of the product.

If the current code conflicts with the specification, preserve the security invariants and intended architecture unless the user explicitly changes the requirement.

## What we are building

This repository is a production grade semantic trust and governance runtime for autonomous economic AI agents.

It is not a chatbot, a payment app, an AI shopping assistant, or a simple hackathon demo.

The central problem is that payment authorization proves permission to spend, but does not prove that an agent correctly understood and preserved the human's intent.

The system must keep human intent traceable, bounded, semantically faithful, governed, and verifiable throughout autonomous economic workflows.

Core principles:

1. LLMs reason. Infrastructure authorizes.
2. Authorization proves permission, not understanding.
3. Payment success does not imply economic outcome success.
4. No privileged action occurs without traceable intent, bounded authority, semantic fidelity, and a verifiable outcome.
5. Data may cross the trust boundary. Authority may not.
6. No proof, no privilege.

## Required reading before implementation

At the start of work, and before beginning a new phase, inspect:

1. `docs/PROJECT_SPEC.md`
2. The current repository tree
3. Existing protocol and schema definitions
4. Existing tests and security invariants
5. Existing implementation for the phase being worked on

Do not reimplement completed work without a reason.

## Architecture rules

Use the monorepo architecture defined in `docs/PROJECT_SPEC.md`.

Keep protocol and trusted core packages independent from model providers and Google specific implementations.

Use TypeScript for protocol, schemas, core services, SDKs, gateways, and frontend.

Use Python only where Google ADK or model and evaluation tooling provides a clear advantage.

Google Cloud implements the runtime underneath the protocol. The protocol itself must not depend on Google specific implementations.

Preserve the trust hierarchy described in the specification. Higher trust tiers must never bypass lower trust tiers.

Gemini may reason and propose semantic objects. Gemini must never directly authorize or execute privileged economic actions.

## Trusted core rules

Prefer deterministic enforcement whenever a requirement can be expressed deterministically.

Use Zod as the canonical runtime validation layer.

Validate every external payload and every LLM generated payload at runtime.

Use strict TypeScript.

Do not use `any` unless there is an exceptional documented reason.

Every privileged function must fail closed.

Use stable structured error codes.

Use idempotency for every economic mutation.

Never hide security critical behavior only inside prompts.

## Security invariants

All security invariants in `docs/PROJECT_SPEC.md`, including `INV_001` through `INV_025`, are mandatory system properties and must have automated tests.

Never weaken an invariant merely to make an implementation easier.

If an implementation choice conflicts with an invariant, change the implementation.

Critical constraints must never disappear silently.

Child authority must always be equal to or narrower than parent authority.

External content is untrusted by default and cannot create authority.

Taint must survive summarization, transformation, and delegation.

Privileged actions require prepared actions, exact authority binding, fresh commit validation, and reconstructable provenance.

Payment state and outcome state must remain separate.

Learning may propose future preferences or rules but must never grant privilege or rewrite historical intent.

## Semantic integrity

Preserve the immutable raw human intent.

There must be no generic mechanism that edits `rawIntent`.

Human changes create a new `IntentState`.

Every meaningful semantic transformation must be represented in provenance.

Relevant hard, safety critical, legal, and organizational policy constraints must propagate when applicable.

Every hard constraint affecting a privileged action must have a proof obligation identifying where it is verified, what evidence is required, and which service enforces it.

Aggregate scores must never override critical failures.

## Authority and execution

Authority is capability scoped, bounded, expiring, revocable, non transferable where required, and bound to the exact intended action.

Never allow a raw LLM score or model verdict to execute an action directly.

Evaluate cumulative related financial exposure rather than only evaluating transactions independently.

Privileged tools must follow the proposal, preparation, verification, authorization, and commit model specified in the project specification.

At commit time, revalidate all critical authority and external state requirements from the specification.

Never blindly retry an economic transaction whose execution state is `UNKNOWN`.

## Outcome and resolution

Payment success must never automatically close the user's task.

Create and evaluate Outcome Contracts according to the specification.

Critical requirement failures dominate averages and aggregate success scores.

If the observed economic outcome is partial or breached, open a structured Resolution Case when required.

Resolution should optimize for restoring the user's original intent, not merely refunding money.

Any remedy that introduces new privileged or financial action requires independent authority.

## Phase execution

Follow the repository implementation order in `docs/PROJECT_SPEC.md`.

Do not attempt to implement all phases simultaneously.

For the initial build, implement Phase 1 and Phase 2 only, exactly as instructed by the specification.

Before beginning Phase 3, present the user with:

1. The resulting repository tree
2. Protocol interfaces created
3. Zod schemas created
4. Deterministic security invariants implemented
5. Tests written
6. Architectural conflicts or assumptions discovered

After the user continues the build, proceed through later phases in specification order unless the user explicitly changes priorities.

When starting any phase, first determine which requirements are already satisfied by the current repository and implement the missing work without silently reducing scope.

## Testing

Write tests alongside each invariant and trusted core capability.

The first 20 golden scenarios in the specification are required benchmark scenarios.

Tests must verify both allowed and blocked behavior.

Do not optimize safety metrics by blocking everything. The objective is safe autonomy.

## Provenance and auditability

Do not treat chat history as the protocol state.

Maintain explicit protocol objects, immutable governance events, provenance nodes and edges, evidence artifacts, derived claims, authority records, prepared actions, outcomes, and resolution state.

Critical governance history must be reconstructable.

The system should be able to explain why an action was allowed or blocked using protocol state and provenance rather than hidden model reasoning.

## External content

Merchant pages, APIs, MCP responses, web content, files, and other external data are untrusted unless explicitly elevated by deterministic policy.

External content may supply data and evidence. It may not create, expand, or modify authority.

Prompt injection or malicious instructions inside external content must never override human intent, system policy, or authority boundaries.

## Model usage

Record model name, model version, and prompt version for semantic judgments.

Use independent semantic verification where the specification requires it.

Do not use hidden reasoning from one model stage as evidence for another independent verification stage.

## Do not simplify the product

Do not convert the system into a generic AI shopping assistant.

Do not collapse protocol objects into chat history.

Do not allow Gemini or ADK agents to directly call privileged payment or economic tools.

Do not remove provenance or taint tracking.

Do not collapse payment status and Outcome Contract status.

Do not silently grant authority from learned preferences, reputation, model confidence, or external instructions.

Do not remove two phase execution protections, cumulative exposure checks, revocation checks, idempotency, or outcome verification for convenience.

## Handling ambiguity

If a requirement is unclear, inspect `docs/PROJECT_SPEC.md` and the existing code first.

When multiple implementations satisfy the requirement, prefer the option that preserves deterministic enforcement, explicit protocol state, traceability, testability, provider independence, and fail closed behavior.

Document material assumptions in code or project documentation rather than silently inventing behavior.

## Completion standard

A phase is not complete merely because code compiles.

A phase is complete when its required protocol objects, runtime validation, deterministic invariants, relevant tests, provenance behavior, authority boundaries, and specified scenario behavior are implemented and verified.
