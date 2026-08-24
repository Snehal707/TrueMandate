/**
 * Wave 4.3 — Firestore-backed MonitoringContractStore.
 * Create-once by id; workflow index for getByWorkflowId.
 */
import {
  assertPrivilegedActionAllowed,
  parseMonitoringContract,
  type MonitoringContractStore,
} from "@truemandate/authority";
import { ErrorCode, err, ok, type MonitoringContract, type Result } from "@truemandate/protocol";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";
import { FirestoreKeyValueRepository } from "./repositories.js";

export class FirestoreMonitoringContractStore implements MonitoringContractStore {
  private readonly rows: FirestoreKeyValueRepository<unknown>;

  constructor(private readonly store: DocumentStore) {
    this.rows = new FirestoreKeyValueRepository(store, COLLECTIONS.monitoringContracts);
  }

  async get(id: string): Promise<Result<MonitoringContract | undefined>> {
    try {
      const value = await this.rows.get(id);
      if (value === undefined) return ok(undefined);
      return parseMonitoringContract(value, "StoredMonitoringContract");
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "MonitoringContract read failed");
    }
  }

  async getByWorkflowId(
    workflowId: string,
  ): Promise<Result<MonitoringContract | undefined>> {
    try {
      const idx = await this.store.get<{ id: string }>(
        docPath(COLLECTIONS.monitoringWorkflowIndex, workflowId),
      );
      if (!idx?.id) return ok(undefined);
      return this.get(idx.id);
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "MonitoringContract workflow index read failed");
    }
  }

  async putIfAbsent(
    id: string,
    value: MonitoringContract,
  ): Promise<Result<boolean>> {
    const validated = parseMonitoringContract(value, "MonitoringContract");
    if (!validated.ok) return validated as Result<boolean>;
    try {
      return ok(
        await this.store.runTransaction(async (tx) => {
          const path = docPath(COLLECTIONS.monitoringContracts, id);
          if (await tx.get(path)) return false;
          const idxPath = docPath(
            COLLECTIONS.monitoringWorkflowIndex,
            validated.value.workflowId,
          );
          await tx.set(path, validated.value);
          await tx.set(idxPath, { id });
          return true;
        }),
      );
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "MonitoringContract write failed");
    }
  }

  async put(id: string, value: MonitoringContract): Promise<Result<void>> {
    const validated = parseMonitoringContract(value, "MonitoringContract");
    if (!validated.ok) return validated as Result<void>;
    try {
      await this.store.runTransaction(async (tx) => {
        const path = docPath(COLLECTIONS.monitoringContracts, id);
        const idxPath = docPath(
          COLLECTIONS.monitoringWorkflowIndex,
          validated.value.workflowId,
        );
        await tx.set(path, validated.value);
        await tx.set(idxPath, { id });
      });
      return ok();
    } catch {
      return err(ErrorCode.VALIDATION_FAILED, "MonitoringContract update failed");
    }
  }

  /** Convenience for AuthorityService choke-point wiring. */
  async assertPrivilegedActionAllowed(
    workflowId: string,
  ): Promise<Result<{ readonly requiresApproval: boolean }>> {
    const loaded = await this.getByWorkflowId(workflowId);
    if (!loaded.ok) return loaded;
    return assertPrivilegedActionAllowed(loaded.value);
  }
}

export function createMonitoringContractRepository(
  store: DocumentStore,
): FirestoreMonitoringContractStore {
  return new FirestoreMonitoringContractStore(store);
}
