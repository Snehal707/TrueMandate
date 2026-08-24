import { hashCanonical } from "@truemandate/crypto";
import { compileAndVerify } from "@truemandate/intent-compiler";
import { IntentService } from "@truemandate/intent-service";
import { VertexGeminiModel } from "@truemandate/model";
import { ProvenanceService } from "@truemandate/provenance-service";

process.env.VERTEX_PROJECT = "elite-crossbar-505104-t9";
process.env.VERTEX_LOCATION = "global";
process.env.GEMINI_MODEL = "gemini-3.7-flash";

const model = VertexGeminiModel.fromEnv();

if (!model.ok) {
  throw new Error(model.message);
}

const intents = new IntentService();
const provenance = new ProvenanceService();
const rawText =
  "Pay approved vendor invoice INV-2026-001 one time for under USD 25000 before November 30, 2026.";

const artifactOk = async (raw: unknown) => {
  const payload =
    raw && typeof raw === "object" && "payload" in raw
      ? (raw as { payload: unknown }).payload
      : undefined;
  return {
    ok: true as const,
    value: {
      ...(raw && typeof raw === "object" ? raw : {}),
      contentHash: hashCanonical(payload),
    },
  };
};

const result = await compileAndVerify(
  {
    principalId: "wave4-live-proof",
    rawText,
    intentId: "local-debug-invoice-intent",
    createdAt: "2026-08-23T00:00:00.000Z",
  },
  {
    intents: {
      createIntent: (raw) => intents.createIntent(raw),
      getIntent: (id) => intents.getIntent(id),
      createCompilation: artifactOk,
      createCompilationVerification: artifactOk,
      finalizeCompilation: async () => ({
        ok: false as const,
        code: "VALIDATION_FAILED" as const,
        message: "skip finalize",
      }),
    },
    provenance,
    compilerModel: model.value,
    verifierModel: model.value,
  },
);

console.log(JSON.stringify(result, null, 2));
