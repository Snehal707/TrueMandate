import { AuthorityGrantSchema, CommitTokenSchema, PreparedActionRecordSchema } from "@truemandate/schemas";
import { ErrorCode, err, ok, type AuthorityGrant, type CommitToken, type PreparedActionRecord, type Result } from "@truemandate/protocol";
import { assertPreparedActionIntegrity } from "./prepared-action.js";
import { assertCommitTokenIntegrity } from "./commit-token-integrity.js";

/** Strict owner-side parsing for records reloaded from durable storage. */
export function parsePreparedActionRecord(value: unknown): Result<PreparedActionRecord> {
  const parsed = PreparedActionRecordSchema.safeParse(value);
  if (!parsed.success) return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid durable PreparedActionRecord");
  const record = parsed.data as unknown as PreparedActionRecord;
  const integrity = assertPreparedActionIntegrity(record.preparedAction);
  return integrity.ok ? ok(record) : integrity as Result<PreparedActionRecord>;
}

export function parseAuthorityGrant(value: unknown): Result<AuthorityGrant> {
  const parsed = AuthorityGrantSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data as unknown as AuthorityGrant)
    : err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid durable AuthorityGrant");
}

export function parseCommitToken(value: unknown): Result<CommitToken> {
  const parsed = CommitTokenSchema.safeParse(value);
  if (!parsed.success) return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid durable CommitToken");
  const token = parsed.data as unknown as CommitToken;
  const integrity = assertCommitTokenIntegrity(token);
  return integrity.ok ? ok(token) : integrity as Result<CommitToken>;
}
