import {
  ProvenanceNodeKind,
  TaintClass,
  TrustClass,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  COLLECTIONS,
  MemoryTransactionalStore,
  createFirestorePersistence,
  docPath,
} from "./index.js";

const CREATED_AT = "2026-08-25T00:00:00.000Z";

function node(id: string) {
  return {
    id,
    kind: ProvenanceNodeKind.INTENT,
    label: `intent ${id}`,
    createdAt: CREATED_AT,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: { classes: [TaintClass.NONE], origins: [] },
  };
}

describe("provenance collection-backed listing", () => {
  it("appends many immutable records without rewriting the legacy global index", async () => {
    const store = new MemoryTransactionalStore();
    const legacyPath = docPath(`${COLLECTIONS.provenanceNodes}/_meta`, "all");
    const legacy = { ids: ["historical-node"] };
    await store.set(legacyPath, legacy);
    const persistence = createFirestorePersistence(store);

    await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const payload = node(`node-${index}`);
      await persistence.provenance.appendNode({
        id: payload.id,
        payload,
        createdAt: CREATED_AT,
      });
    }));

    expect(await store.get(legacyPath)).toEqual(legacy);
    expect(await persistence.provenance.listNodes()).toHaveLength(100);
  });

  it("keeps identical replay idempotent and divergent replay fail-closed", async () => {
    const persistence = createFirestorePersistence(new MemoryTransactionalStore());
    const payload = node("node-replay");
    const record = { id: payload.id, payload, createdAt: CREATED_AT };
    await persistence.provenance.appendNode(record);
    await persistence.provenance.appendNode(record);
    await expect(persistence.provenance.appendNode({
      ...record,
      payload: { ...payload, label: "divergent" },
    })).rejects.toThrow("Divergent immutable provenance node");
    expect(await persistence.provenance.listNodes()).toHaveLength(1);
  });
});
