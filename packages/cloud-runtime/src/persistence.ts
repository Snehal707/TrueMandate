import {
  createFirestorePersistence,
  GoogleFirestoreDocumentStore,
  MemoryTransactionalStore,
  persistenceModeFromEnv,
  type DocumentStore,
  type FirestorePersistenceBundle,
} from "@truemandate/cloud-firestore";
import { RuntimeConfigError } from "./config.js";

export interface FirestoreClientHandle {
  readonly projectId: string;
  readonly databaseId: string;
}

export interface ReadinessProbeResult {
  readonly ready: boolean;
  readonly reason?: string;
}

export interface RuntimePersistence {
  readonly mode: "memory" | "firestore";
  readonly bundle: FirestorePersistenceBundle;
  readonly firestoreClient?: FirestoreClientHandle;
  readonly store: DocumentStore;
  probeReadiness(): Promise<ReadinessProbeResult>;
}

async function probeOrThrow(
  store: DocumentStore,
  failReason: string,
): Promise<void> {
  try {
    await store.probeReachability();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new RuntimeConfigError(`${failReason}: ${message}`);
  }
}

function readinessFromProbe(store: DocumentStore, failCode: string) {
  return async (): Promise<ReadinessProbeResult> => {
    try {
      await store.probeReachability();
      return { ready: true };
    } catch (e) {
      return {
        ready: false,
        reason: e instanceof Error ? e.message : failCode,
      };
    }
  };
}

/**
 * Initialize persistence. Firestore mode retains the Google client and uses
 * GoogleFirestoreDocumentStore — every privileged mutation awaits a commit.
 * TM_FIRESTORE_SKIP_CLIENT is not accepted as a way to advertise firestore
 * while using memory.
 *
 * Readiness is a real Get of `_health/readyz`. A missing document is success.
 * A viewer must not write in order to become ready.
 */
export async function initRuntimePersistence(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimePersistence> {
  const mode = persistenceModeFromEnv(env);

  if (mode === "memory") {
    const store = new MemoryTransactionalStore();
    await probeOrThrow(store, "In-memory persistence reachability probe failed");
    return {
      mode,
      store,
      bundle: createFirestorePersistence(store),
      probeReadiness: readinessFromProbe(store, "memory_probe_failed"),
    };
  }

  const projectId = env.GOOGLE_CLOUD_PROJECT ?? env.GCP_PROJECT ?? "";
  if (!projectId.trim()) {
    throw new RuntimeConfigError(
      "TM_PERSISTENCE=firestore requires GOOGLE_CLOUD_PROJECT",
    );
  }
  const databaseId = env.FIRESTORE_DATABASE ?? "(default)";

  let client: InstanceType<(typeof import("@google-cloud/firestore"))["Firestore"]>;
  try {
    const { Firestore } = await import("@google-cloud/firestore");
    client = new Firestore({
      projectId,
      databaseId: databaseId === "(default)" ? undefined : databaseId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new RuntimeConfigError(
      `Firestore client initialization failed: ${message}`,
    );
  }

  const store = new GoogleFirestoreDocumentStore(client);
  await probeOrThrow(store, "Firestore init probe failed");

  return {
    mode,
    store,
    bundle: createFirestorePersistence(store),
    firestoreClient: { projectId, databaseId },
    probeReadiness: readinessFromProbe(store, "firestore_probe_error"),
  };
}
