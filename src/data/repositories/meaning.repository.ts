import { getDatabase } from '../db/connection';
import type { Transaction } from '../../domain/transactions/transaction.types';
import type { AuditEventInput, AuditMetadata } from '../../domain/audit/audit.types';
import type { MeaningConversionPrevious } from '../../domain/meaning/meaning.rules';
import {
  MEANING_KINDS,
  MeaningKind,
  MeaningReason,
  MeaningResolution,
  MeaningRule,
  MeaningSuggestion,
} from '../../domain/meaning/meaning.types';
import { asNullableString, asNumber, asString, SqlRow } from '../mappers/coerce';
import { parseAuditMetadata } from '../mappers/audit.mapper';
import { auditRepository, SqlExecutor } from './audit.repository';
import { updateTransactionTx } from './transaction.repository';

/**
 * R5e money meaning persistence. Every money change (a confirmed meaning,
 * its Undo) writes the transaction row(s), the suggestion row(s), the rule
 * and ONE audit row in a single `db.transaction` — all land or none do.
 * Rows hold ids, enums, a public bank id and a last-4 / wallet id only.
 */

const REASONS: ReadonlySet<string> = new Set(['rule', 'unique', 'ambiguous', 'missing']);
const RESOLUTIONS: ReadonlySet<string> = new Set(['transfer', 'expense', 'paired']);

function kindOf(value: unknown): MeaningKind {
  const s = asString(value);
  return (MEANING_KINDS as ReadonlyArray<string>).includes(s) ? (s as MeaningKind) : 'transfer';
}

export function rowToMeaningRule(row: SqlRow): MeaningRule {
  return {
    id: asString(row.id),
    bankCanonical: asString(row.bank_canonical),
    kind: kindOf(row.kind),
    counterpartyKey: asString(row.counterparty_key ?? ''),
    targetAccountId: asString(row.target_account_id),
    createdAt: asString(row.created_at),
  };
}

export function rowToMeaningSuggestion(row: SqlRow): MeaningSuggestion {
  const reason = asString(row.reason);
  const resolution = asNullableString(row.resolution);
  return {
    transactionId: asString(row.transaction_id),
    kind: kindOf(row.kind),
    targetAccountId: asNullableString(row.target_account_id),
    reason: (REASONS.has(reason) ? reason : 'missing') as MeaningReason,
    bankCanonical: asString(row.bank_canonical ?? ''),
    counterpartyKey: asString(row.counterparty_key ?? ''),
    createdAt: asString(row.created_at),
    resolvedAt: asNullableString(row.resolved_at),
    resolution: resolution && RESOLUTIONS.has(resolution) ? (resolution as MeaningResolution) : null,
  };
}

const SUGGESTION_UPSERT =
  'INSERT OR REPLACE INTO money_meaning_suggestions (transaction_id, kind, target_account_id, reason, bank_canonical, counterparty_key, created_at, resolved_at, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
const SUGGESTION_INSERT_NEW = SUGGESTION_UPSERT.replace('INSERT OR REPLACE', 'INSERT OR IGNORE');

function suggestionParams(s: MeaningSuggestion): Array<string | null> {
  return [
    s.transactionId,
    s.kind,
    s.targetAccountId,
    s.reason,
    s.bankCanonical,
    s.counterpartyKey,
    s.createdAt,
    s.resolvedAt,
    s.resolution,
  ];
}

async function upsertSuggestionsTx(tx: SqlExecutor, rows: ReadonlyArray<MeaningSuggestion>): Promise<void> {
  for (const row of rows) await tx.execute(SUGGESTION_UPSERT, suggestionParams(row));
}

async function listRules(): Promise<MeaningRule[]> {
  const result = await getDatabase().execute('SELECT * FROM money_meaning_rules ORDER BY created_at');
  return result.rows.map(rowToMeaningRule);
}

async function listSuggestions(): Promise<MeaningSuggestion[]> {
  const result = await getDatabase().execute('SELECT * FROM money_meaning_suggestions ORDER BY created_at');
  return result.rows.map(rowToMeaningSuggestion);
}

/**
 * New suggestions (sync / re-scan). INSERT OR IGNORE: a transaction that
 * already has one (open or closed) keeps it — the user is never asked twice.
 * No money changes, so no audit row.
 */
async function addSuggestions(rows: ReadonlyArray<MeaningSuggestion>): Promise<void> {
  if (rows.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const row of rows) await tx.execute(SUGGESTION_INSERT_NEW, suggestionParams(row));
  });
}

/** "It's an expense" (or income): close the suggestion. No money change → no audit. */
async function resolveSuggestion(row: MeaningSuggestion): Promise<void> {
  await getDatabase().execute(SUGGESTION_UPSERT, suggestionParams(row));
}

/** A rule write made by a confirm (and reverted by its Undo). */
export type MeaningRuleWrite =
  | { op: 'insert'; rule: MeaningRule }
  | { op: 'retarget'; id: string; targetAccountId: string }
  | { op: 'delete'; id: string };

async function writeRuleTx(tx: SqlExecutor, write: MeaningRuleWrite | null): Promise<void> {
  if (!write) return;
  if (write.op === 'insert') {
    const r = write.rule;
    await tx.execute(
      'INSERT OR REPLACE INTO money_meaning_rules (id, bank_canonical, kind, counterparty_key, target_account_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [r.id, r.bankCanonical, r.kind, r.counterpartyKey, r.targetAccountId, r.createdAt],
    );
  } else if (write.op === 'retarget') {
    await tx.execute('UPDATE money_meaning_rules SET target_account_id = ? WHERE id = ?', [
      write.targetAccountId,
      write.id,
    ]);
  } else {
    await tx.execute('DELETE FROM money_meaning_rules WHERE id = ?', [write.id]);
  }
}

export interface MeaningConfirmWrite {
  transfer: Transaction;
  twin: Transaction | null;
  suggestions: ReadonlyArray<MeaningSuggestion>;
  rule: MeaningRuleWrite | null;
  audit: {
    actor: 'user' | 'system';
    meaning: MeaningKind;
    rule: boolean;
    previous: MeaningConversionPrevious;
    ruleId: string | null;
    ruleCreated: boolean;
    previousRuleTarget: string | null;
    /** R5e-FIX K1: a late counterpart hidden as an existing transfer's twin. */
    twinAdded?: boolean;
  };
}

/** Confirm (user) or rule conversion (sync): rows + suggestions + rule + 'transfer_marked'. */
async function confirm(write: MeaningConfirmWrite): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, write.transfer);
    if (write.twin) await updateTransactionTx(tx, write.twin);
    await upsertSuggestionsTx(tx, write.suggestions);
    await writeRuleTx(tx, write.rule);
    const event: AuditEventInput = {
      eventType: 'transfer_marked',
      actor: write.audit.actor,
      transactionId: write.transfer.id,
      accountId: write.transfer.accountId,
      metadata: {
        kind: 'transfer_marked',
        transaction_id: write.transfer.id,
        twin_id: write.twin?.id ?? null,
        meaning: write.audit.meaning,
        rule: write.audit.rule,
        previous: write.audit.previous,
        rule_id: write.audit.ruleId,
        rule_created: write.audit.ruleCreated,
        previous_rule_target: write.audit.previousRuleTarget,
        ...(write.audit.twinAdded ? { twin_added: true } : {}),
      },
    };
    await auditRepository.insert(tx, event);
  });
}

export interface MeaningUndoWrite {
  transfer: Transaction;
  twin: Transaction | null;
  suggestions: ReadonlyArray<MeaningSuggestion>;
  rule: MeaningRuleWrite | null;
  meaning: MeaningKind;
  /** R5e-FIX K1: only the late twin came back; the transfer row is not written. */
  twinOnly?: boolean;
}

/** Undo of a confirmed meaning: rows restored + suggestions reopened + rule reverted + 'transfer_unmarked'. */
async function undo(write: MeaningUndoWrite): Promise<void> {
  await getDatabase().transaction(async tx => {
    if (!write.twinOnly) await updateTransactionTx(tx, write.transfer);
    if (write.twin) await updateTransactionTx(tx, write.twin);
    await upsertSuggestionsTx(tx, write.suggestions);
    await writeRuleTx(tx, write.rule);
    await auditRepository.insert(tx, {
      eventType: 'transfer_unmarked',
      actor: 'user',
      transactionId: write.transfer.id,
      accountId: write.transfer.accountId,
      metadata: {
        kind: 'transfer_unmarked',
        transaction_id: write.transfer.id,
        twin_id: write.twin?.id ?? null,
        meaning: write.meaning,
        ...(write.twinOnly ? { twin_only: true } : {}),
      },
    });
  });
}

/** Settings → Automatic money rules → Remove ('meaning_rule_removed', enum + bank id only). */
async function removeRule(rule: MeaningRule): Promise<void> {
  await getDatabase().transaction(async tx => {
    await tx.execute('DELETE FROM money_meaning_rules WHERE id = ?', [rule.id]);
    await auditRepository.insert(tx, {
      eventType: 'meaning_rule_removed',
      actor: 'user',
      accountId: rule.targetAccountId,
      metadata: { kind: 'meaning_rule_removed', meaning: rule.kind, bankCanonical: rule.bankCanonical },
    });
  });
}

/** Suggestions of rows a pair confirm / undo touches (R3a "It's a transfer"). */
async function setSuggestionsTx(tx: SqlExecutor, rows: ReadonlyArray<MeaningSuggestion>): Promise<void> {
  await upsertSuggestionsTx(tx, rows);
}

/**
 * The 'transfer_marked' payload still in effect for this transfer row (Undo
 * source). R5e-FIX: marks stack — each 'transfer_unmarked' cancels the newest
 * mark still standing — so after a late twin (K1) is undone, the original
 * conversion is next; an undone mark is never replayed.
 */
async function latestMark(
  transferId: string,
): Promise<{ metadata: Extract<AuditMetadata, { kind: 'transfer_marked' }>; eventAt: string } | null> {
  const result = await getDatabase().execute('SELECT * FROM audit_events WHERE transaction_id = ?', [transferId]);
  const rows = result.rows
    .filter((row: SqlRow) => row.event_type === 'transfer_marked' || row.event_type === 'transfer_unmarked')
    .sort(
      (a: SqlRow, b: SqlRow) =>
        asString(a.event_at).localeCompare(asString(b.event_at)) || asNumber(a.rowid ?? 0) - asNumber(b.rowid ?? 0),
    );
  const standing: Array<{ metadata: Extract<AuditMetadata, { kind: 'transfer_marked' }>; eventAt: string }> = [];
  for (const row of rows) {
    const metadata = parseAuditMetadata(row.metadata_json);
    if (metadata?.kind === 'transfer_marked' && metadata.transaction_id === transferId) {
      standing.push({ metadata, eventAt: asString(row.event_at) });
    } else if (metadata?.kind === 'transfer_unmarked' && metadata.transaction_id === transferId) {
      standing.pop();
    }
  }
  return standing.length > 0 ? standing[standing.length - 1] : null;
}

export const meaningRepository = {
  listRules,
  listSuggestions,
  addSuggestions,
  resolveSuggestion,
  confirm,
  undo,
  removeRule,
  setSuggestionsTx,
  latestMark,
};
