import type { DocumentData, Firestore, Transaction } from "@google-cloud/firestore";
import {
  firestoreRefParts,
  type DocPath,
  type DocumentStore,
  type TxContext,
  READY_PROBE_PATH,
} from "./document-store.js";

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isAborted(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 10 ||
    code === "ABORTED" ||
    /ABORTED|aborted|contention/i.test(message)
  );
}

/**
 * Production DocumentStore. Every mutation awaits a Google Firestore commit.
 */
export class GoogleFirestoreDocumentStore implements DocumentStore {
  readonly kind = "firestore" as const;

  constructor(private readonly db: Firestore) {}

  private ref(path: DocPath) {
    const { collection, id } = firestoreRefParts(path);
    return this.db.collection(collection).doc(id);
  }

  async get<T = unknown>(path: DocPath): Promise<T | undefined> {
    const snap = await this.ref(path).get();
    return snap.exists ? (snap.data() as T) : undefined;
  }

  async listCollection<T = unknown>(collection: string): Promise<readonly T[]> {
    const snapshot = await this.db.collection(collection).get();
    return snapshot.docs.map((doc) => doc.data() as T);
  }

  async set<T>(path: DocPath, value: T): Promise<void> {
    await this.ref(path).set(stripUndefined(value) as DocumentData);
  }

  async delete(path: DocPath): Promise<void> {
    await this.ref(path).delete();
  }

  async runTransaction<T>(fn: (tx: TxContext) => Promise<T> | T): Promise<T> {
    try {
      return await this.db.runTransaction(
        async (googleTx: Transaction) => {
          const ctx: TxContext = {
            get: async <U>(path: DocPath) => {
              const snap = await googleTx.get(this.ref(path));
              return snap.exists ? (snap.data() as U) : undefined;
            },
            set: async <U>(path: DocPath, value: U) => {
              googleTx.set(
                this.ref(path),
                stripUndefined(value) as DocumentData,
              );
            },
            delete: async (path: DocPath) => {
              googleTx.delete(this.ref(path));
            },
          };
          return await fn(ctx);
        },
        { maxAttempts: 8 },
      );
    } catch (error) {
      if (isAborted(error)) {
        throw new Error("TRANSACTION_CONFLICT:max_retries");
      }
      throw error;
    }
  }

  async probeReachability(): Promise<void> {
    await this.get(READY_PROBE_PATH);
  }
}

export function createGoogleFirestoreDocumentStore(
  db: Firestore,
): GoogleFirestoreDocumentStore {
  return new GoogleFirestoreDocumentStore(db);
}
