import type { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";
import { MemoryTransactionalStore, READY_PROBE_PATH } from "./document-store.js";
import { GoogleFirestoreDocumentStore } from "./google-store.js";

function fakeFirestore(getImpl: () => Promise<{ exists: boolean }>): Firestore {
  return {
    collection: () => ({
      doc: () => ({
        get: getImpl,
      }),
    }),
  } as unknown as Firestore;
}

describe("probeReachability", () => {
  it("treats a missing in-memory document as reachable", async () => {
    const store = new MemoryTransactionalStore();
    await expect(store.get(READY_PROBE_PATH)).resolves.toBeUndefined();
    await expect(store.probeReachability()).resolves.toBeUndefined();
  });

  it("treats a successful missing-document Get as reachable", async () => {
    const store = new GoogleFirestoreDocumentStore(
      fakeFirestore(async () => ({ exists: false })),
    );
    await expect(store.probeReachability()).resolves.toBeUndefined();
  });

  it("fails reachability when Get throws", async () => {
    const store = new GoogleFirestoreDocumentStore(
      fakeFirestore(async () => {
        throw new Error("PERMISSION_DENIED");
      }),
    );
    await expect(store.probeReachability()).rejects.toThrow("PERMISSION_DENIED");
  });
});
