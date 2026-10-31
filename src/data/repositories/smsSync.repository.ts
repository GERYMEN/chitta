import { getDatabase } from '../db/connection';

/**
 * R4b: read-only helper over `sms_sync_runs` (base schema). Only the
 * earliest `started_at` is needed, for the upgrade default of the SMS sync
 * start. No SMS content lives in this table.
 */
async function firstRunStartedAtMs(): Promise<number | null> {
  const result = await getDatabase().execute(
    'SELECT MIN(started_at) AS first_started_at FROM sms_sync_runs',
  );
  const value = result.rows.length > 0 ? result.rows[0].first_started_at : null;
  if (value == null) return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : null;
}

export const smsSyncRepository = {
  firstRunStartedAtMs,
};
