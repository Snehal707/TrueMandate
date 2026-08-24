import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";

/**
 * Tracks unresolved UNKNOWN economic executions so new CommitTokens cannot
 * salami-attack cumulative exposure while reconciliation is open.
 */
export interface EconomicReservation {
  readonly key: string;
  readonly preparedActionHash: string;
  readonly grantId: string;
  readonly exposureEntryId: string;
  readonly amount: number;
  readonly currency: string;
  readonly relatedGroupId: string;
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly sideEffectOccurred?: boolean;
}

export interface EconomicReservationStore {
  get(key: string): Promise<EconomicReservation | undefined>;
  getByPreparedHash(hash: string): Promise<EconomicReservation | undefined>;
  getUnresolvedByPreparedHash(hash: string): Promise<EconomicReservation | undefined>;
  put(reservation: EconomicReservation): Promise<Result<EconomicReservation>>;
  resolve(
    key: string,
    sideEffectOccurred: boolean,
    now: string,
  ): Promise<Result<EconomicReservation>>;
  listUnresolved(): Promise<readonly EconomicReservation[]>;
  /** Prepared hashes that must not receive another CommitToken (spent / reconciled). */
  isPreparedHashNonReusable(hash: string): Promise<boolean>;
  markPreparedHashNonReusable(hash: string): Promise<void>;
}

export class InMemoryEconomicReservationStore implements EconomicReservationStore {
  private readonly byKey = new Map<string, EconomicReservation>();
  private readonly nonReusableHashes = new Set<string>();

  async get(key: string): Promise<EconomicReservation | undefined> {
    return this.byKey.get(key);
  }

  async getByPreparedHash(hash: string): Promise<EconomicReservation | undefined> {
    return [...this.byKey.values()].find((r) => r.preparedActionHash === hash);
  }

  async getUnresolvedByPreparedHash(
    hash: string,
  ): Promise<EconomicReservation | undefined> {
    return [...this.byKey.values()].find(
      (r) => r.preparedActionHash === hash && r.resolvedAt === undefined,
    );
  }

  async put(reservation: EconomicReservation): Promise<Result<EconomicReservation>> {
    if (this.nonReusableHashes.has(reservation.preparedActionHash)) {
      return err(
        ErrorCode.RECONCILIATION_REQUIRED,
        "PreparedAction hash already spent via UNKNOWN reconciliation",
        { preparedActionHash: reservation.preparedActionHash },
      );
    }
    if (
      [...this.byKey.values()].some(
        (r) =>
          r.preparedActionHash === reservation.preparedActionHash &&
          r.resolvedAt === undefined &&
          r.key !== reservation.key,
      )
    ) {
      return err(
        ErrorCode.RECONCILIATION_REQUIRED,
        "Unresolved UNKNOWN reservation already exists for this PreparedAction",
        { preparedActionHash: reservation.preparedActionHash },
      );
    }
    this.byKey.set(reservation.key, reservation);
    return ok(reservation);
  }

  async resolve(
    key: string,
    sideEffectOccurred: boolean,
    now: string,
  ): Promise<Result<EconomicReservation>> {
    const existing = this.byKey.get(key);
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
    this.byKey.set(key, resolved);
    // Both outcomes: this prepared hash must not free-reuse for a new CommitToken.
    this.nonReusableHashes.add(existing.preparedActionHash);
    return ok(resolved);
  }

  async listUnresolved(): Promise<readonly EconomicReservation[]> {
    return [...this.byKey.values()].filter((r) => r.resolvedAt === undefined);
  }

  async isPreparedHashNonReusable(hash: string): Promise<boolean> {
    return this.nonReusableHashes.has(hash);
  }

  async markPreparedHashNonReusable(hash: string): Promise<void> {
    this.nonReusableHashes.add(hash);
  }

  clear(): void {
    this.byKey.clear();
    this.nonReusableHashes.clear();
  }
}

export async function assertNoUnresolvedReservation(
  store: EconomicReservationStore,
  preparedActionHash: string,
): Promise<Result<void>> {
  if (await store.isPreparedHashNonReusable(preparedActionHash)) {
    return err(
      ErrorCode.RECONCILIATION_REQUIRED,
      "PreparedAction hash is non-reusable after UNKNOWN reconciliation",
      { preparedActionHash },
    );
  }
  const open = await store.getUnresolvedByPreparedHash(preparedActionHash);
  if (open) {
    return err(
      ErrorCode.RECONCILIATION_REQUIRED,
      "Cannot issue CommitToken while UNKNOWN execution awaits reconciliation",
      {
        preparedActionHash,
        executionId: open.executionId,
        reservationKey: open.key,
      },
    );
  }
  return ok();
}
