import type { InternalRoute } from "@truemandate/cloud-runtime";
import { ErrorCode, err, ok, type EvidenceClaim, type EvidenceEnvelope, type Result } from "@truemandate/protocol";
import {
  EvidenceClaimSchema,
  EvidenceEnvelopeSchema,
  PublicEvidenceSubmissionSchema,
  type PublicEvidenceSubmission,
  parseWithSchema,
} from "@truemandate/schemas";
import { z } from "zod";

/**
 * A configured acceptance-fixture writer: the verified caller identity plus
 * the only fixture id namespace that identity may create. The namespace is
 * bound to the identity server-side — never taken from the fixture payload.
 */
export interface AcceptanceFixtureWriter {
  readonly email: string;
  readonly idPrefix: string;
}

// Wave 1 adds the wave1- family; prefixes remain server-side constants bound
// to verified caller identities — never derived from fixture payloads.
const ACCEPTANCE_PREFIX_PATTERN = /^(phase|wave1)-[a-z0-9]*-?$/;

/**
 * Namespace-scoped acceptance fixture schema. Every envelope and claim id
 * must carry the writer's exact prefix; mixed or foreign namespaces fail
 * validation before anything is persisted.
 */
export function makeAcceptanceFixtureSchema(idPrefix: string) {
  if (!ACCEPTANCE_PREFIX_PATTERN.test(idPrefix)) {
    throw new Error(`Invalid acceptance fixture namespace: ${idPrefix}`);
  }
  return z.object({
    envelopes: z.array(EvidenceEnvelopeSchema).min(1),
    claims: z.array(EvidenceClaimSchema).default([]),
  }).strict().superRefine((fixture, ctx) => {
    for (const envelope of fixture.envelopes) {
      if (!String(envelope.id).startsWith(idPrefix)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Acceptance evidence ids must be ${idPrefix} scoped` });
      }
    }
    for (const claim of fixture.claims) {
      if (!String(claim.id).startsWith(idPrefix)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Acceptance claim ids must be ${idPrefix} scoped` });
      }
    }
  });
}

/**
 * Compose the route-specific evidence reader identities. Readers ADD to the
 * existing global caller policy — they must never displace the coordinator's
 * chain-era envelope reads.
 */
export function composeEvidenceReaderEmails(
  globalCallers: readonly string[],
  readerEnv: string | undefined,
): readonly string[] {
  return [
    ...globalCallers,
    ...(readerEnv ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter((value, index, all) => all.indexOf(value) === index);
}

export function composeEvidenceSubmitCallerEmails(
  callerEnv: string | undefined,
): readonly string[] {
  return (callerEnv ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

/** Read-only owner surface. Evidence writes remain owned by the later evidence ingestion boundary. */
export function createEvidenceInternalRoutes(owner: {
  getEnvelope(id: string): Promise<EvidenceEnvelope | undefined>;
  getClaim(id: string): Promise<EvidenceClaim | undefined>;
  /**
   * What an envelope asserts. A consumer holding an envelope id can already read
   * every claim on it one at a time; this only spares it from having to guess the
   * ids. Read-only, and it confers no trust of its own.
   */
  listClaimsForEnvelope?(envelopeId: string): Promise<readonly EvidenceClaim[]>;
  /** Deliberately narrow, owner-backed acceptance fixture seam. Receives the route-validated fixture. */
  persistFixture?(fixture: unknown): Promise<Result<unknown>>;
  /** Governed production evidence submission seam. Never a verifier fixture writer. */
  persistSubmission?(
    submission: PublicEvidenceSubmission,
    callerEmail: string,
  ): Promise<Result<unknown>>;
  /** Trusted verification seam that creates derivative verified evidence rows. */
  persistVerification?(raw: unknown, callerEmail: string): Promise<Result<unknown>>;
}, fixtureWriters: readonly AcceptanceFixtureWriter[] = [], readCallers: readonly string[] = [], submitCallers: readonly string[] = [], verifyCallers: readonly string[] = []): readonly InternalRoute[] {
  const response = (result: Result<unknown>) => result.ok
    ? { status: 200, body: result.value }
    : { status: 404, body: { error: result.code, message: result.message } };
  const writeResponse = (result: Result<unknown>) =>
    result.ok
      ? { status: 200, body: result.value }
      : {
          status: result.details?.retryable === true ? 503 : 400,
          body: {
            error: result.code,
            message: result.message,
            details: result.details,
          },
        };
  const fixtureWriterEmails = fixtureWriters.map((writer) => writer.email);
  return [
    { method: "GET", pattern: "/internal/evidence/envelopes/:id", allowedCallers: readCallers.length > 0 ? readCallers : undefined, handler: async ({ params }) => {
      const raw = await owner.getEnvelope(params.id ?? "");
      return response(raw ? parseWithSchema(EvidenceEnvelopeSchema, raw, "OwnerEvidenceEnvelope") : err(ErrorCode.VALIDATION_FAILED, "Unknown evidence envelope"));
    } },
    { method: "GET", pattern: "/internal/evidence/claims/:id", allowedCallers: readCallers.length > 0 ? readCallers : undefined, handler: async ({ params }) => {
      const raw = await owner.getClaim(params.id ?? "");
      return response(raw ? parseWithSchema(EvidenceClaimSchema, raw, "OwnerEvidenceClaim") : err(ErrorCode.VALIDATION_FAILED, "Unknown evidence claim"));
    } },
    ...(owner.listClaimsForEnvelope ? [{
      method: "GET" as const,
      pattern: "/internal/evidence/envelopes/:id/claims",
      allowedCallers: readCallers.length > 0 ? readCallers : undefined,
      handler: async ({ params }: { params: Record<string, string | undefined> }) => {
        const envelopeId = params.id ?? "";
        const envelope = await owner.getEnvelope(envelopeId);
        if (!envelope) {
          return response(err(ErrorCode.VALIDATION_FAILED, "Unknown evidence envelope"));
        }
        const rows = await owner.listClaimsForEnvelope!(envelopeId);
        const claims: unknown[] = [];
        for (const row of rows) {
          const parsedClaim = parseWithSchema(EvidenceClaimSchema, row, "OwnerEvidenceClaim");
          if (!parsedClaim.ok) return response(parsedClaim);
          claims.push(parsedClaim.value);
        }
        return response(ok({ envelopeId, claims }));
      },
    }] : []),
    ...(owner.persistFixture && fixtureWriters.length > 0 ? [{
      method: "POST" as const,
      pattern: "/internal/evidence/acceptance-fixtures",
      allowedCallers: fixtureWriterEmails,
      handler: async ({ body, caller }: { body: unknown; caller?: { email?: string } }) => {
        // Caller-bound namespace: the verified service identity decides which
        // fixture namespaces it may create. Unknown callers are rejected
        // before any persistence even if middleware auth is not enabled. A
        // caller may hold MULTIPLE server-side namespaces (e.g. the trusted
        // phase-c verifier also drives wave1- acceptance) — every matching
        // writer is tried, and the fixture must fit exactly one namespace.
        const writers = fixtureWriters.filter((candidate) => candidate.email === caller?.email);
        if (writers.length === 0) {
          return { status: 403, body: { error: "PERMISSION_DENIED", message: "Unknown acceptance fixture caller" } };
        }
        let lastParse: Result<unknown> | undefined;
        for (const writer of writers) {
          const parsed = parseWithSchema(makeAcceptanceFixtureSchema(writer.idPrefix), body, "EvidenceAcceptanceFixture");
          if (parsed.ok) return response(await owner.persistFixture!(parsed.value));
          lastParse = parsed;
        }
        if (lastParse) return response(lastParse);
        return response(err(ErrorCode.VALIDATION_FAILED, "Fixture ids do not match any caller-bound namespace"));
      },
    }] : []),
    ...(owner.persistSubmission && submitCallers.length > 0 ? [{
      method: "POST" as const,
      pattern: "/internal/evidence/submissions",
      allowedCallers: submitCallers,
      handler: async ({ body, caller }: { body: unknown; caller?: { email?: string } }) => {
        if (!caller?.email) {
          return {
            status: 403,
            body: { error: "PERMISSION_DENIED", message: "Unknown evidence submission caller" },
          };
        }
        const parsed = parseWithSchema(
          PublicEvidenceSubmissionSchema,
          body,
          "PublicEvidenceSubmission",
        );
        if (!parsed.ok) return writeResponse(parsed);
        const normalizedSubmission: PublicEvidenceSubmission = {
          ...parsed.value,
          claims: parsed.value.claims ?? [],
        };
        return writeResponse(
          await owner.persistSubmission!(normalizedSubmission, caller.email),
        );
      },
    }] : []),
    ...(owner.persistVerification && verifyCallers.length > 0 ? [{
      method: "POST" as const,
      pattern: "/internal/evidence/verifications",
      allowedCallers: verifyCallers,
      handler: async ({ body, caller }: { body: unknown; caller?: { email?: string } }) => {
        if (!caller?.email) {
          return {
            status: 403,
            body: { error: "PERMISSION_DENIED", message: "Unknown evidence verification caller" },
          };
        }
        return writeResponse(await owner.persistVerification!(body, caller.email));
      },
    }] : []),
  ];
}
