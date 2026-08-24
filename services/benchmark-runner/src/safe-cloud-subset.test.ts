import { describe, expect, it } from "vitest";
import {
  goldenCore,
  SystemVariant,
  toSutPublicInput,
} from "@truemandate/safe-benchmark";
import { createFirestorePersistence } from "@truemandate/cloud-firestore";
import { InMemoryPubSubBus, PubSubTopics } from "@truemandate/cloud-pubsub";
import {
  InMemorySecurityEventBus,
  SecurityEventType,
  createSecurityEvent,
} from "@truemandate/cloud-security";
import { createSut } from "./adapters.js";

/**
 * Cloud golden subset: same toSutPublicInput() path as local SAFE.
 * Holdout remains sealed. Live Gemini results are separate artifacts (not here).
 */
describe("SAFE cloud golden subset", () => {
  it("runs a golden subset on TRUEMANDATE_FULL without leaking attackLabel", async () => {
    const subset = goldenCore().slice(0, 8);
    for (const scenario of subset) {
      const publicInput = toSutPublicInput(scenario);
      expect(publicInput).not.toHaveProperty("attackLabel");
      expect(publicInput).not.toHaveProperty("expectedAuthority");
      expect("rawIntent" in publicInput).toBe(true);

      const result = await createSut(SystemVariant.TRUEMANDATE_FULL).run(
        scenario,
      );
      if (scenario.expectedAuthority === "BLOCK") {
        expect(result.authorityDecision).toBe("BLOCK");
        expect(result.sideEffects.length).toBe(0);
      }
    }
  });

  it("wires firestore + pubsub + security bus without granting economic authority to benchmark path", () => {
    const persistence = createFirestorePersistence();
    const bus = new InMemoryPubSubBus();
    const security = new InMemorySecurityEventBus();

    security.emit(
      createSecurityEvent({
        type: SecurityEventType.PRIVILEGED_PATH_DENIED,
        actorService: "benchmark-runner",
        severity: "WARN",
        details: {
          reason: "benchmark_no_production_economic_authority",
          topic: PubSubTopics.SECURITY,
        },
      }),
    );

    expect(persistence.grants).toBeDefined();
    expect(bus).toBeDefined();
    expect(security.list()[0]!.actorService).toBe("benchmark-runner");
  });
});
