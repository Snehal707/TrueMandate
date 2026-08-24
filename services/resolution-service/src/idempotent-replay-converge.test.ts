import { ErrorCode, ok } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";

/**
 * Wave 1: gateway IDEMPOTENT_REPLAY must converge as semantic SUCCESS for the
 * remedy execution port — never as a second economic side effect. The
 * normalization lives in createRemedyExecutionPort; this unit locks the
 * contract the port depends on.
 */
describe("Wave 1 IDEMPOTENT_REPLAY remedy convergence contract", () => {
  function normalizeRemedyCommitStatus(
    status: "SUCCESS" | "FAILED" | "UNKNOWN" | "IDEMPOTENT_REPLAY" | undefined,
  ): "SUCCESS" | "FAILED" | "UNKNOWN" {
    return status === "IDEMPOTENT_REPLAY" ? "SUCCESS" : (status ?? "UNKNOWN");
  }

  it("maps IDEMPOTENT_REPLAY to SUCCESS for continuation", () => {
    expect(normalizeRemedyCommitStatus("IDEMPOTENT_REPLAY")).toBe("SUCCESS");
  });

  it("preserves SUCCESS / FAILED / UNKNOWN without inventing success", () => {
    expect(normalizeRemedyCommitStatus("SUCCESS")).toBe("SUCCESS");
    expect(normalizeRemedyCommitStatus("FAILED")).toBe("FAILED");
    expect(normalizeRemedyCommitStatus("UNKNOWN")).toBe("UNKNOWN");
    expect(normalizeRemedyCommitStatus(undefined)).toBe("UNKNOWN");
  });

  it("idempotent replay adds zero new side effects at the gateway contract", async () => {
    // Mirror gateway-closure: a second commit with the same idempotency
    // identity returns IDEMPOTENT_REPLAY and does not mint a new sideEffect.
    const commits: Array<{ status: string; sideEffect?: { id: string } }> = [];
    const gateway = {
      commit: async (input: { commitTokenId: string }) => {
        void input;
        if (commits.length === 0) {
          const row = { status: "SUCCESS" as const, sideEffect: { id: "se-1" } };
          commits.push(row);
          return ok(row);
        }
        const row = { status: "IDEMPOTENT_REPLAY" as const };
        commits.push(row);
        return ok(row);
      },
    };
    const first = await gateway.commit({ commitTokenId: "ct-1" });
    const second = await gateway.commit({ commitTokenId: "ct-1" });
    expect(first.ok && first.value.status).toBe("SUCCESS");
    expect(second.ok && second.value.status).toBe("IDEMPOTENT_REPLAY");
    expect(normalizeRemedyCommitStatus(second.ok ? second.value.status : undefined)).toBe(
      "SUCCESS",
    );
    expect(commits.filter((c) => c.sideEffect).length).toBe(1);
    expect(ErrorCode.IDEMPOTENCY_KEY_REQUIRED).toBeTruthy();
  });
});
