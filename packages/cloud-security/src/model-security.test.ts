import { TaintClass } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { FakeModelArmor } from "./fake-model-security.js";
import {
  ModelArmorAdapter,
  requireModelArmorSafe,
} from "./model-armor-adapter.js";
import {
  ModelInspectionStatus,
  isModelInspectionSafe,
} from "./model-security-port.js";

const taintedInput = {
  requestId: "req-1",
  content: "buy containers from merchant page",
  taint: {
    classes: [TaintClass.EXTERNAL_CONTENT, TaintClass.UNVERIFIED_CLAIM],
    origins: ["node-ext-1"],
    reason: "merchant HTML",
  },
};

describe("ModelSecurityPort", () => {
  it("treats UNAVAILABLE as not safe (fail-closed)", async () => {
    const armor = new FakeModelArmor({ unavailable: true });
    const result = await armor.inspect(taintedInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(ModelInspectionStatus.UNAVAILABLE);
      expect(isModelInspectionSafe(result.value)).toBe(false);
    }

    const adapter = new ModelArmorAdapter();
    const adapterResult = await adapter.inspect(taintedInput);
    expect(adapterResult.ok).toBe(false);
    if (!adapterResult.ok) {
      expect(adapterResult.code).toBe("MODEL_UNAVAILABLE");
    }
    expect(requireModelArmorSafe(adapterResult).ok).toBe(false);
  });

  it("never clears taint on CLEAN inspection", async () => {
    const armor = new FakeModelArmor({ defaultStatus: ModelInspectionStatus.CLEAN });
    const result = await armor.inspect(taintedInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(ModelInspectionStatus.CLEAN);
      expect(result.value.taint).toEqual(taintedInput.taint);
      expect(result.value.taint.classes).toContain(TaintClass.EXTERNAL_CONTENT);
      expect(result.value.taint.classes).toContain(TaintClass.UNVERIFIED_CLAIM);
    }
  });

  it("records inspectionRequested/result/failure audit trails", async () => {
    const armor = new FakeModelArmor({ unavailable: true });
    await armor.inspect(taintedInput);
    expect(armor.inspectionRequested).toHaveLength(1);
    expect(armor.inspectionFailures).toHaveLength(1);
    expect(armor.inspectionResults).toHaveLength(0);

    const adapter = new ModelArmorAdapter();
    adapter.setAvailable(true);
    await adapter.inspect({ ...taintedInput, requestId: "req-2" });
    expect(adapter.inspectionRequested).toHaveLength(1);
    expect(adapter.inspectionResults).toHaveLength(1);
  });

  it("fromEnv reads TM_MODEL_ARMOR_TEMPLATE; unavailable is not safe; CLEAN preserves taint", async () => {
    const fromEnv = ModelArmorAdapter.fromEnv({
      TM_MODEL_ARMOR_TEMPLATE:
        "projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response",
      GOOGLE_CLOUD_PROJECT: "elite-crossbar-505104-t9",
    });
    expect(fromEnv.configured).toBe(true);
    expect(fromEnv.templateId).toContain("tm-dev-prompt-response");

    const unavailable = await fromEnv.inspect(taintedInput);
    expect(unavailable.ok).toBe(false);
    expect(requireModelArmorSafe(unavailable).ok).toBe(false);

    fromEnv.setAvailable(true);
    const clean = await fromEnv.inspect(taintedInput);
    expect(clean.ok).toBe(true);
    if (clean.ok) {
      expect(clean.value.status).toBe(ModelInspectionStatus.CLEAN);
      expect(clean.value.taint).toEqual(taintedInput.taint);
    }
  });
});
