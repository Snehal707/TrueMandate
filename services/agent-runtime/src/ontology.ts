import { domainOntology } from "@truemandate/domain-ontology";
import type { ConceptFamily } from "@truemandate/semantic-readiness";

/**
 * Adapts @truemandate/domain-ontology's server-owned canonical concept data
 * into the ConceptFamily[] shape @truemandate/semantic-readiness (proof
 * matching, action fidelity) already consumes — dropping only the
 * prompt-only `description` field. This is the single point where
 * agent-runtime's domain packs read canonical concepts; no domain pack
 * hand-duplicates its own conceptFamilies list anymore.
 *
 * Throws for a packId with no ontology entry: every domain pack registered
 * in agent-runtime is expected to have a matching ontology entry — this is
 * a build-time configuration invariant between two packages that must stay
 * in sync, not a runtime input to validate defensively.
 */
export function conceptFamiliesFor(packId: string): readonly ConceptFamily[] {
  const ontology = domainOntology(packId);
  if (!ontology) {
    throw new Error(`No @truemandate/domain-ontology entry for packId '${packId}'`);
  }
  return ontology.concepts.map(
    ({ canonicalConcept, aliases, factFamilies, defaultFactType }): ConceptFamily => ({
      canonicalConcept,
      aliases,
      ...(factFamilies ? { factFamilies } : {}),
      ...(defaultFactType ? { defaultFactType } : {}),
    }),
  );
}
