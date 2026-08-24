import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  loadRuntimeConfig,
  requireModelArmorConfig,
  requireVertexConfig,
} from "@truemandate/cloud-runtime";
import { ModelArmorAdapter } from "@truemandate/cloud-security";
import { VertexGeminiModel } from "@truemandate/model";
import { initTracing, InMemoryModelTelemetryCollector } from "@truemandate/observability";
import { ScenarioRunner } from "../runner.js";

/**
 * HTTP /healthz only. Does not auto-run golden scenarios against live payments.
 */
async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  requireVertexConfig(config);
  requireModelArmorConfig(config);
  // Wave 2: model-call telemetry for the benchmark runner is kept run-scoped
  // and in-memory rather than durable/Firestore — benchmark scenario runs
  // must never pollute the production `modelCalls` collection.
  const telemetry = new InMemoryModelTelemetryCollector();
  const vertex = VertexGeminiModel.fromEnv(undefined, telemetry);
  if (!vertex.ok) {
    throw new Error(vertex.message);
  }
  const armor = ModelArmorAdapter.fromEnv();
  if (!(await armor.probe())) {
    throw new Error("Model Armor probe failed — fail closed");
  }
  const runner = new ScenarioRunner();
  void runner;
  void vertex.value;

  const http = createCloudRunHttpServer({
    config,
    bus: new InMemoryPubSubBus(),
    acceptedTopics: [],
    health: { ready: true },
    extraHealth: {
      scenarioRunner: "loaded",
      autoRunGolden: false,
      vertex: "initialized",
      armorConfigured: armor.configured,
      modelTelemetry: telemetry.summary(),
    },
    enableEvents: false,
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "benchmark-runner listening",
      service: config.serviceName,
      port: config.port,
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
