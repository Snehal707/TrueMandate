export const COMPILER_PROMPT_VERSION = "v1";
export const COMPILER_SCHEMA_ID = "compiler.candidate.v1";
export const COMPILER_SCHEMA_VERSION = "1";

export const COMPILER_SYSTEM_INSTRUCTION = `
You are the TrueMandate Intent Compiler.
Extract a structured candidate interpretation from immutable raw human intent.

Rules:
- Preserve grounding: every constraint needs sourceText from the raw intent; prefer character offsets.
- Classify meaning as EXPLICIT, IMPLIED, INFERRED, or UNKNOWN.
- INFERRED/UNKNOWN must never be sticky HARD / SAFETY_CRITICAL / LEGAL / ORGANIZATIONAL_POLICY.
- Do not invent constraints (e.g. BPA_free) unless the source supports them.
- Preserve negation (do not, nothing, not, avoid, never, excluding).
- Map "under/below/at most" budgets to LT/LTE — never to approximately.
- Soft preferences stay PREFERENCE/SOFT; hard requirements stay HARD.
- Record ambiguities (e.g. approved supplier without approval source).
- Output JSON only matching the provided schema. No chain-of-thought.

Financial constraint values must be plain finite numbers (the canonical monetary
amount, e.g. 800000 for "under INR 800000"). The currency is grounded in the raw
human text — never attach currency objects or empty value objects to a
budget/price constraint. Do not fabricate amounts.
`.trim();

export interface CompilerDomainVocabulary {
  readonly packId: string;
  readonly concepts: readonly { readonly canonicalConcept: string; readonly description: string }[];
}

/**
 * Appends domain-scoped vocabulary guidance for a domain-aware compilation.
 * The enum restriction itself lives in the structured-output schema (see
 * buildCompilerModelOutputSchema) — this text exists only to give the model
 * enough semantic context to pick the RIGHT canonical concept, not to teach
 * it spelling. Preferences are never restricted to this vocabulary.
 */
export function compilerSystemInstructionFor(domain?: CompilerDomainVocabulary): string {
  if (!domain || domain.concepts.length === 0) return COMPILER_SYSTEM_INSTRUCTION;
  const vocabulary = domain.concepts
    .map((concept) => `- ${concept.canonicalConcept}: ${concept.description}`)
    .join("\n");
  return `${COMPILER_SYSTEM_INSTRUCTION}

This intent is being compiled for the "${domain.packId}" domain. Every entry in
"constraints" (never "preferences") MUST use exactly one of these canonical
concept identifiers for its "concept" field — never a synonym, abbreviation,
or invented identifier:
${vocabulary}

Match each constraint to whichever canonical concept its meaning corresponds
to. If a piece of raw text does not correspond to any of the concepts above
and is not otherwise execution-relevant, do not extract a constraint for it.`;
}
