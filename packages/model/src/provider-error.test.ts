import { describe, expect, it } from "vitest";
import {
  readSanitizedProviderError,
  sanitizeGoogleProviderError,
} from "./provider-error.js";

describe("sanitized Google provider errors", () => {
  it("retains allowlisted quota and retry metadata", () => {
    const headers = new Headers({
      "retry-after": "2",
      "x-goog-request-id": "provider-request-17",
    });
    const result = sanitizeGoogleProviderError({
      error: {
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
            domain: "googleapis.com",
            metadata: {
              service: "aiplatform.googleapis.com",
              quotaMetric: "generate_content_requests",
              credential: "must-not-survive",
            },
          },
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ subject: "projects/project-id", description: "request-rate" }],
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "1.5s",
          },
        ],
      },
    }, headers);
    expect(result).toMatchObject({
      status: "RESOURCE_EXHAUSTED",
      reason: "RATE_LIMIT_EXCEEDED",
      domain: "googleapis.com",
      retryDelayMs: 1500,
      retryAfterMs: 2000,
      providerRequestId: "provider-request-17",
    });
    expect(result?.metadata).toEqual({
      service: "aiplatform.googleapis.com",
      quotaMetric: "generate_content_requests",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-survive");
  });

  it("drops malformed and secret-like unrestricted values", () => {
    const result = sanitizeGoogleProviderError({
      error: {
        status: "RESOURCE_EXHAUSTED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "Bearer secret-value",
          domain: "https://protected.example/internal?token=secret",
          metadata: { password: "secret", service: "Bearer secret-value" },
        }],
      },
    });
    expect(result).toEqual({
      status: "RESOURCE_EXHAUSTED",
      reason: undefined,
      domain: undefined,
      metadata: undefined,
      quotaViolations: undefined,
      retryDelayMs: undefined,
      retryAfterMs: undefined,
      providerRequestId: undefined,
    });
  });

  it("handles malformed and oversized bodies without retaining raw content", async () => {
    const malformed = await readSanitizedProviderError(new Response(
      "Bearer very-secret-value",
      { status: 429, headers: { "retry-after": "1" } },
    ));
    expect(malformed).toMatchObject({ retryAfterMs: 1000 });
    expect(JSON.stringify(malformed)).not.toContain("secret");
    const oversized = sanitizeGoogleProviderError({
      error: {
        status: "X".repeat(2_000),
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "Y".repeat(2_000),
        }],
      },
    });
    expect(oversized).toBeUndefined();
  });
});
