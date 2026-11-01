import { z } from 'zod';
import {
  BACKUP_TABLES,
  backupTableSpec,
  columnsAt,
  DEVICE_LOCAL_SETTING_KEYS,
} from './backup.tables';

/**
 * R4e: the JSON inside an encrypted backup file. Pure — no I/O. Holds only
 * what the database already holds (raw SMS bodies are never stored, so none
 * are exported).
 *
 *   { format: 1, app: {versionName, versionCode}, schemaVersion,
 *     createdAt (ISO), tables: { <table>: rows[] } }
 */
export const BACKUP_FORMAT = 1;

/** A cell: SQLite TEXT / INTEGER / REAL / NULL (no BLOB columns exist). */
export type BackupCell = string | number | null;
export type BackupRow = Record<string, BackupCell>;
export type BackupTables = Record<string, BackupRow[]>;

const cellSchema = z.union([z.string(), z.number().finite(), z.null()]);

export const backupPayloadSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  app: z.object({
    versionName: z.string().max(64),
    versionCode: z.number().int().min(0),
  }),
  schemaVersion: z.number().int().min(0),
  createdAt: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'createdAt'),
  tables: z.record(z.string(), z.array(z.record(z.string(), cellSchema))),
});

export type BackupPayload = z.infer<typeof backupPayloadSchema>;

export type BackupErrorCode =
  | 'cancelled'
  | 'not_backup'
  | 'too_new'
  | 'bad_password'
  | 'incomplete'
  | 'busy'
  | 'io';

/** Fixed, data-free messages (never a value from the file or the DB). */
export const BACKUP_ERROR_MESSAGES: Record<BackupErrorCode, string> = {
  cancelled: 'No file was picked.',
  not_backup: 'This file is not a Tracker backup, or it is damaged.',
  too_new: 'Backup is from a newer app — update Tracker first.',
  bad_password: 'Wrong password or damaged file.',
  incomplete: 'This backup is incomplete or damaged.',
  busy: 'Wait for the SMS sync to finish, then try again.',
  io: 'Could not read or write the backup file. Please try again.',
};

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string = BACKUP_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface BuildBackupInput {
  tables: BackupTables;
  app: { versionName: string; versionCode: number };
  schemaVersion: number;
  now: Date;
}

/** The payload for the current DB contents. Device-local settings are left out. */
export function buildBackupPayload(input: BuildBackupInput): BackupPayload {
  const tables: BackupTables = {};
  for (const spec of BACKUP_TABLES) {
    const rows = input.tables[spec.name] ?? [];
    tables[spec.name] =
      spec.name === 'app_settings'
        ? rows.filter(row => !DEVICE_LOCAL_SETTING_KEYS.includes(String(row.key)))
        : rows;
  }
  return {
    format: BACKUP_FORMAT,
    app: {
      versionName: String(input.app.versionName ?? ''),
      versionCode: Math.max(0, Math.floor(Number(input.app.versionCode) || 0)),
    },
    schemaVersion: input.schemaVersion,
    createdAt: input.now.toISOString(),
    tables,
  };
}

/**
 * Parse + validate decrypted JSON. Throws BackupError:
 * - not_backup: not JSON / wrong shape / unknown table or column
 * - too_new: a newer format, or schemaVersion above this app's
 * - incomplete: a table that existed at the backup's schemaVersion is missing
 */
export function parseBackupJson(json: string, currentSchemaVersion: number): BackupPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupError('not_backup');
  }
  return validateBackupPayload(raw, currentSchemaVersion);
}

export function validateBackupPayload(raw: unknown, currentSchemaVersion: number): BackupPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BackupError('not_backup');
  const format = (raw as { format?: unknown }).format;
  if (typeof format === 'number' && Number.isInteger(format) && format > BACKUP_FORMAT) {
    throw new BackupError('too_new');
  }
  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion === 'number' && schemaVersion > currentSchemaVersion) {
    throw new BackupError('too_new');
  }
  const parsed = backupPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError('not_backup');
  const payload = parsed.data;

  for (const name of Object.keys(payload.tables)) {
    if (!backupTableSpec(name)) throw new BackupError('not_backup');
  }
  for (const spec of BACKUP_TABLES) {
    const rows = payload.tables[spec.name];
    if (spec.sinceVersion > payload.schemaVersion) {
      // Table did not exist yet: absent or empty is fine.
      if (rows && rows.length > 0) throw new BackupError('not_backup');
      continue;
    }
    if (!rows) throw new BackupError('incomplete');
    const allowed = new Set(columnsAt(spec, payload.schemaVersion));
    for (const row of rows) {
      for (const column of Object.keys(row)) {
        if (!allowed.has(column)) throw new BackupError('not_backup');
      }
    }
  }
  return payload;
}

export interface BackupSummary {
  createdAt: string;
  transactions: number;
  accounts: number;
  /** Rows per table (for the audit row — counts only). */
  counts: Record<string, number>;
}

export function summarizeBackup(payload: BackupPayload): BackupSummary {
  const counts: Record<string, number> = {};
  for (const spec of BACKUP_TABLES) counts[spec.name] = payload.tables[spec.name]?.length ?? 0;
  return {
    createdAt: payload.createdAt,
    transactions: counts.transactions ?? 0,
    accounts: counts.accounts ?? 0,
    counts,
  };
}

/** "tracker-backup-2026-11-01.trkbak" (local date). */
export function defaultBackupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `tracker-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.trkbak`;
}
