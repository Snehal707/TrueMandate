# Firestore preflight — elite-crossbar-505104-t9

## Procedure (read-only; do not destroy/convert)

1. If `firestore.googleapis.com` is disabled: no managed Firestore API yet.
2. List databases only after API enable (normally via Stage A apply):  
   `gcloud firestore databases describe "(default)" --project=elite-crossbar-505104-t9`
3. If `(default)` exists as **Datastore mode** with legacy data: **do not** convert. Set `firestore_database_id = "tm-primary"` for a new Native DB.
4. If `(default)` missing or Native empty: Stage A creating `FIRESTORE_NATIVE` `(default)` in `us-central1` is the intended strategy.

## Snapshot (pre-hardening review)

| Check | Result |
|-------|--------|
| `firestore.googleapis.com` | Disabled (pre-Stage-A) |
| `datastore.googleapis.com` | Enabled (default GCP surface; not proof of legacy Datastore mode DB) |
| Existing `(default)` Native DB | Not listable while Firestore API disabled — treat as **absent** |
| Strategy | Proceed with Native `(default)` unless apply fails with mode conflict; then switch to `tm-primary` without destroying data |

**Do not automatically destroy or convert existing data.**
