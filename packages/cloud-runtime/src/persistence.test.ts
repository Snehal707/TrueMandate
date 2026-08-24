import { describe, expect, it } from "vitest";
import { READY_PROBE_PATH } from "@truemandate/cloud-firestore";
import { initRuntimePersistence } from "./persistence.js";
import { RuntimeConfigError } from "./config.js";

describe("initRuntimePersistence", () => {
  it("uses memory mode without a Google client and is ready without a sentinel write", async () => {
    const persist = await initRuntimePersistence({
      TM_PERSISTENCE: "memory",
      TM_SERVICE_NAME: "test-memory",
    });
    expect(persist.mode).toBe("memory");
    expect(persist.firestoreClient).toBeUndefined();
    expect(persist.store.kind).toBe("memory");
    expect(persist.bundle.intents).toBeDefined();
    expect(await persist.store.get(READY_PROBE_PATH)).toBeUndefined();
    const ready = await persist.probeReadiness();
    expect(ready.ready).toBe(true);
  });

  it("fail-closes firestore mode without GOOGLE_CLOUD_PROJECT", async () => {
    await expect(
      initRuntimePersistence({
        TM_PERSISTENCE: "firestore",
        GOOGLE_CLOUD_PROJECT: "",
      }),
    ).rejects.toThrow(RuntimeConfigError);
  });

  it("ignores TM_FIRESTORE_SKIP_CLIENT and does not fall back to memory", async () => {
    const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      await expect(
        initRuntimePersistence({
          TM_PERSISTENCE: "firestore",
          GOOGLE_CLOUD_PROJECT: "test-proj",
          TM_SERVICE_NAME: "skip-client",
          TM_FIRESTORE_SKIP_CLIENT: "true",
        }),
      ).rejects.toThrow(/Firestore init probe failed|Firestore client/);
    } finally {
      if (previousHost) process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    }
  });
});
