import { describe, expect, it } from "vitest";
import { COLLECTIONS, docPath, firestoreRefParts } from "./document-store.js";

describe("firestoreRefParts injective encoding", () => {
  it("keeps a/b and a__b as distinct document ids", () => {
    const slash = firestoreRefParts(docPath("intents", "a/b"));
    const dunder = firestoreRefParts(docPath("intents", "a__b"));
    expect(slash.collection).toBe("intents");
    expect(dunder.collection).toBe("intents");
    expect(slash.id).toBe(encodeURIComponent("a/b"));
    expect(dunder.id).toBe(encodeURIComponent("a__b"));
    expect(slash.id).not.toBe(dunder.id);
  });

  it("does not collide a slash id with a percent-encoded slash literal", () => {
    const slash = firestoreRefParts(docPath("intents", "a/b"));
    const encoded = firestoreRefParts(docPath("intents", "a%2Fb"));
    expect(slash.id).toBe("a%2Fb");
    expect(encoded.id).toBe("a%252Fb");
    expect(slash.id).not.toBe(encoded.id);
  });

  it("rejects repeated separators and empty segments", () => {
    expect(() => firestoreRefParts("intents//a")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("intents/a//b")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("intents/")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("/a")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("intents")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("")).toThrow(/Invalid document path/);
  });

  it("rejects . and .. segments", () => {
    expect(() => firestoreRefParts("./id")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("intents/.")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("intents/..")).toThrow(/Invalid document path/);
    expect(() => firestoreRefParts("intents/a/..")).toThrow(/Invalid document path/);
  });

  it("encodes Unicode distinctly from ASCII lookalikes", () => {
    const cafe = firestoreRefParts(docPath("intents", "café"));
    const ascii = firestoreRefParts(docPath("intents", "cafe"));
    expect(cafe.id).not.toBe(ascii.id);
    expect(cafe.id).toBe(encodeURIComponent("café"));
  });

  it("keeps nested helper paths unique from joined-form document ids", () => {
    const meta = firestoreRefParts(docPath(`${COLLECTIONS.provenanceNodes}/_meta`, "all"));
    const joined = firestoreRefParts(docPath(COLLECTIONS.provenanceNodes, "_meta__all"));
    const slashId = firestoreRefParts(docPath(COLLECTIONS.provenanceNodes, "_meta/all"));
    expect(meta.id).toBe(encodeURIComponent("_meta/all"));
    expect(joined.id).toBe(encodeURIComponent("_meta__all"));
    expect(slashId.id).toBe(encodeURIComponent("_meta/all"));
    expect(meta.id).toBe(slashId.id);
    expect(meta.id).not.toBe(joined.id);

    const index = firestoreRefParts(
      docPath(`${COLLECTIONS.exposure}/_index`, "group-1"),
    );
    const indexJoined = firestoreRefParts(
      docPath(COLLECTIONS.exposure, "_index__group-1"),
    );
    expect(index.id).not.toBe(indexJoined.id);

    const byHash = firestoreRefParts(
      docPath(`${COLLECTIONS.economicReservations}/_byHash`, "abc"),
    );
    const byHashJoined = firestoreRefParts(
      docPath(COLLECTIONS.economicReservations, "_byHash__abc"),
    );
    expect(byHash.id).not.toBe(byHashJoined.id);
  });
});
