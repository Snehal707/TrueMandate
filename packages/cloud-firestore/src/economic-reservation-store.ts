import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";
import type {
  EconomicReservation,
  EconomicReservationStore,
} from "@truemandate/authority";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

interface HashIndex {
  readonly keys: string[];
}

function hashIndexPath(hash: string): string {
  return docPath(`${COLLECTIONS.economicReservations}/_byHash`, hash);
}

function nonReusablePath(hash: string): string {
  return docPath(`${COLLECTIONS.economicReservations}/_nonReusable`, hash);
}

function unresolvedIndexPath(): string {
  return docPath(`${COLLECTIONS.economicReservations}/_meta`, "unresolved");
}

export class FirestoreEconomicReservationStore
  implements EconomicReservationStore
{
  constructor(private readonly store: DocumentStore) {}

  async get(key: string): Promise<EconomicReservation | undefined> {
    return this.store.get(docPath(COLLECTIONS.economicReservations, key));
  }

  async getByPreparedHash(hash: string): Promise<EconomicReservation | undefined> {
    const idx = await this.store.get<HashIndex>(hashIndexPath(hash));
    if (!idx?.keys.length) return undefined;
    return this.get(idx.keys[0]!);
  }

  async getUnresolvedByPreparedHash(
    hash: string,
  ): Promise<EconomicReservation | undefined> {
    const idx = await this.store.get<HashIndex>(hashIndexPath(hash));
    if (!idx) return undefined;
    for (const key of idx.keys) {
      const r = await this.get(key);
      if (r && r.resolvedAt === undefined) return r;
    }
    return undefined;
  }

  async put(
    reservation: EconomicReservation,
  ): Promise<Result<EconomicReservation>> {
    return this.store.runTransaction(async (tx) => {
      const nonReusable = await tx.get(nonReusablePath(reservation.preparedActionHash));
      const hPath = hashIndexPath(reservation.preparedActionHash);
      const idx = (await tx.get<HashIndex>(hPath)) ?? { keys: [] };
      const unresolved = (await tx.get<HashIndex>(unresolvedIndexPath())) ?? { keys: [] };
      const existingByKey: EconomicReservation[] = [];
      for (const key of idx.keys) {
        const r = await tx.get<EconomicReservation>(
          docPath(COLLECTIONS.economicReservations, key),
        );
        if (r) existingByKey.push(r);
      }
      if (nonReusable) {
        return err(
          ErrorCode.RECONCILIATION_REQUIRED,
          "PreparedAction hash already spent via UNKNOWN reconciliation",
          { preparedActionHash: reservation.preparedActionHash },
        );
      }
      for (const r of existingByKey) {
        if (r.resolvedAt === undefined && r.key !== reservation.key) {
          return err(
            ErrorCode.RECONCILIATION_REQUIRED,
            "Unresolved UNKNOWN reservation already exists for this PreparedAction",
            { preparedActionHash: reservation.preparedActionHash },
          );
        }
      }
      const path = docPath(COLLECTIONS.economicReservations, reservation.key);
      await tx.set(path, reservation);
      if (!idx.keys.includes(reservation.key)) {
        await tx.set(hPath, { keys: [...idx.keys, reservation.key] });
      }
      if (reservation.resolvedAt === undefined && !unresolved.keys.includes(reservation.key)) {
        await tx.set(unresolvedIndexPath(), {
          keys: [...unresolved.keys, reservation.key],
        });
      }
      return ok(reservation);
    });
  }

  async resolve(
    key: string,
    sideEffectOccurred: boolean,
    now: string,
  ): Promise<Result<EconomicReservation>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.economicReservations, key);
      const existing = await tx.get<EconomicReservation>(path);
      const unresolved = await tx.get<HashIndex>(unresolvedIndexPath());
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown reservation", { key });
      }
      if (existing.resolvedAt !== undefined) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Reservation already reconciled",
          { key },
        );
      }
      const resolved: EconomicReservation = {
        ...existing,
        resolvedAt: now,
        sideEffectOccurred,
      };
      await tx.set(path, resolved);
      await tx.set(nonReusablePath(existing.preparedActionHash), { at: now });
      if (unresolved) {
        await tx.set(unresolvedIndexPath(), {
          keys: unresolved.keys.filter((k) => k !== key),
        });
      }
      return ok(resolved);
    });
  }

  async listUnresolved(): Promise<readonly EconomicReservation[]> {
    const u = await this.store.get<HashIndex>(unresolvedIndexPath());
    if (!u) return [];
    const rows = await Promise.all(u.keys.map((k) => this.get(k)));
    return rows.filter((r): r is EconomicReservation => r !== undefined);
  }

  async isPreparedHashNonReusable(hash: string): Promise<boolean> {
    return (await this.store.get(nonReusablePath(hash))) !== undefined;
  }

  async markPreparedHashNonReusable(hash: string): Promise<void> {
    await this.store.set(nonReusablePath(hash), {
      at: new Date().toISOString(),
    });
  }
}
