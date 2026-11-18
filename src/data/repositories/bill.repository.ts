import { getDatabase } from '../db/connection';
import type { AuditEventInput } from '../../domain/audit/audit.types';
import {
  Bill,
  BillKind,
  BillPatch,
  BillRepeat,
  BillSource,
  BillStatus,
  BILL_KINDS,
  BILL_STATUSES,
  CreateBillInput,
} from '../../domain/bills/bill.types';
import { nextMonthlyBill } from '../../domain/bills/billMatch.rules';
import { isBillPaid } from '../../domain/bills/bill.rules';
import { asNullableNumber, asNullableString, asNumber, asString, SqlRow } from '../mappers/coerce';
import { auditRepository, SqlExecutor } from './audit.repository';
import { generateId } from '../../shared/utils/id';

/**
 * R5b bills & dues persistence. Every money-relevant change (create, update,
 * mark paid, reopen, dismiss) writes the bill row and ONE audit row in a
 * single `db.transaction`. Rows hold ids, enums, amounts and a payee that is
 * user text or a known issuer display name only — never SMS text or a sender
 * number.
 */

const KIND_SET: ReadonlySet<string> = new Set(BILL_KINDS);
const STATUS_SET: ReadonlySet<string> = new Set(BILL_STATUSES);

function kindOf(value: unknown): BillKind {
  const s = asString(value);
  return KIND_SET.has(s) ? (s as BillKind) : 'manual';
}

function statusOf(value: unknown): BillStatus {
  const s = asString(value);
  return STATUS_SET.has(s) ? (s as BillStatus) : 'open';
}

function repeatOf(value: unknown): BillRepeat {
  return asString(value) === 'monthly' ? 'monthly' : 'none';
}

export function rowToBill(row: SqlRow): Bill {
  return {
    id: asString(row.id),
    accountId: asNullableString(row.account_id),
    kind: kindOf(row.kind),
    payee: asString(row.payee),
    amountDueMinor: asNumber(row.amount_due_minor),
    minDueMinor: asNullableNumber(row.min_due_minor),
    statementDate: asNullableString(row.statement_date),
    dueDate: asNullableString(row.due_date),
    status: statusOf(row.status),
    paidMinor: asNumber(row.paid_minor),
    paidTransactionId: asNullableString(row.paid_transaction_id),
    source: asString(row.source) === 'sms' ? 'sms' : 'manual',
    sourceHash: asNullableString(row.source_hash),
    repeat: repeatOf(row.repeat),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

const UPSERT =
  `INSERT OR REPLACE INTO bills
    (id, account_id, kind, payee, amount_due_minor, min_due_minor, statement_date, due_date,
     status, paid_minor, paid_transaction_id, source, source_hash, repeat, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function params(b: Bill): Array<string | number | null> {
  return [
    b.id,
    b.accountId,
    b.kind,
    b.payee,
    b.amountDueMinor,
    b.minDueMinor,
    b.statementDate,
    b.dueDate,
    b.status,
    b.paidMinor,
    b.paidTransactionId,
    b.source,
    b.sourceHash,
    b.repeat,
    b.createdAt,
    b.updatedAt,
  ];
}

async function upsertTx(tx: SqlExecutor, bill: Bill): Promise<void> {
  await tx.execute(UPSERT, params(bill));
}

async function listAll(): Promise<Bill[]> {
  const result = await getDatabase().execute('SELECT * FROM bills ORDER BY created_at ASC');
  return result.rows.map(rowToBill);
}

export function buildBill(input: CreateBillInput, nowIso: string = new Date().toISOString()): Bill {
  return {
    id: generateId('bill'),
    accountId: input.accountId,
    kind: input.kind,
    payee: input.payee,
    amountDueMinor: input.amountDueMinor,
    minDueMinor: input.minDueMinor,
    statementDate: input.statementDate,
    dueDate: input.dueDate,
    status: 'open',
    paidMinor: 0,
    paidTransactionId: null,
    source: input.source,
    sourceHash: input.sourceHash,
    repeat: input.repeat ?? 'none',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function createdAudit(bill: Bill): AuditEventInput {
  return {
    eventType: 'bill_created',
    actor: bill.source === 'sms' ? 'system' : 'user',
    accountId: bill.accountId,
    metadata: {
      kind: 'bill_created',
      billId: bill.id,
      billKind: bill.kind,
      source: bill.source,
      amountMinor: bill.amountDueMinor,
    },
  };
}

async function create(input: CreateBillInput): Promise<Bill> {
  const bill = buildBill(input);
  await getDatabase().transaction(async tx => {
    await upsertTx(tx, bill);
    await auditRepository.insert(tx, createdAudit(bill));
  });
  return bill;
}

/** Which manual-editable fields a patch actually changes (names only, no values). */
const EDITABLE_BILL_FIELDS = [
  'payee',
  'amountDueMinor',
  'minDueMinor',
  'statementDate',
  'dueDate',
  'accountId',
  'repeat',
] as const;

function changedFields(before: Bill, patch: BillPatch): string[] {
  return EDITABLE_BILL_FIELDS.filter(
    f => f in patch && patch[f] !== undefined && patch[f] !== before[f],
  );
}

async function update(bill: Bill, patch: BillPatch): Promise<Bill> {
  const fields = changedFields(bill, patch);
  const updated: Bill = { ...bill, ...patch, updatedAt: new Date().toISOString() };
  await getDatabase().transaction(async tx => {
    await upsertTx(tx, updated);
    await auditRepository.insert(tx, {
      eventType: 'bill_updated',
      actor: 'user',
      accountId: updated.accountId,
      metadata: { kind: 'bill_updated', billId: updated.id, fields },
    });
  });
  return updated;
}

/**
 * D-e: mark a bill paid — manually or by linking a transaction. A partial
 * payment adds `addMinor` to paid so far; the bill flips to 'paid' when the
 * full amount is covered or `force` is set (manual "Mark as paid"). When a
 * paid monthly manual bill rolls over, next month's open bill is created in
 * the same transaction.
 */
async function markPaid(
  bill: Bill,
  options: { addMinor: number; transactionId: string | null; force: boolean },
): Promise<Bill> {
  const paidMinor = bill.paidMinor + Math.max(0, options.addMinor);
  const now = new Date().toISOString();
  const candidate: Bill = {
    ...bill,
    paidMinor,
    paidTransactionId: options.transactionId ?? bill.paidTransactionId,
    updatedAt: now,
  };
  const paid = options.force || isBillPaid(candidate);
  const updated: Bill = { ...candidate, status: paid ? 'paid' : 'open' };
  const rollover =
    paid && updated.repeat === 'monthly' && updated.source === 'manual'
      ? nextMonthlyBill(updated, () => now, () => generateId('bill'))
      : null;
  await getDatabase().transaction(async tx => {
    await upsertTx(tx, updated);
    await auditRepository.insert(tx, {
      eventType: 'bill_paid',
      actor: 'user',
      transactionId: options.transactionId ?? null,
      accountId: updated.accountId,
      metadata: {
        kind: 'bill_paid',
        billId: updated.id,
        paidMinor: Math.max(0, options.addMinor),
        linked: options.transactionId != null,
      },
    });
    if (rollover) {
      await upsertTx(tx, rollover);
      await auditRepository.insert(tx, createdAudit(rollover));
    }
  });
  return updated;
}

/** Undo "Mark paid": restore the exact prior paid progress + status + link. */
async function reopen(bill: Bill, prior: Pick<Bill, 'paidMinor' | 'paidTransactionId' | 'status'>): Promise<Bill> {
  const updated: Bill = {
    ...bill,
    paidMinor: prior.paidMinor,
    paidTransactionId: prior.paidTransactionId,
    status: prior.status,
    updatedAt: new Date().toISOString(),
  };
  await getDatabase().transaction(async tx => {
    await upsertTx(tx, updated);
    await auditRepository.insert(tx, {
      eventType: 'bill_reopened',
      actor: 'user',
      accountId: updated.accountId,
      metadata: { kind: 'bill_reopened', billId: updated.id },
    });
  });
  return updated;
}

/**
 * D-e: a deleted / undone linked transaction reopens its bill. Reads the live
 * rows, clears the link and the amount it contributed, and sets the bill back
 * to 'open'. No-op when nothing is linked to the transaction.
 */
async function reopenByPaidTransaction(transactionId: string, contributionMinor: number): Promise<void> {
  const result = await getDatabase().execute(
    'SELECT * FROM bills WHERE paid_transaction_id = ?',
    [transactionId],
  );
  if (result.rows.length === 0) return;
  const now = new Date().toISOString();
  await getDatabase().transaction(async tx => {
    for (const row of result.rows) {
      const bill = rowToBill(row);
      const updated: Bill = {
        ...bill,
        paidMinor: Math.max(0, bill.paidMinor - contributionMinor),
        paidTransactionId: null,
        status: 'open',
        updatedAt: now,
      };
      await upsertTx(tx, updated);
      await auditRepository.insert(tx, {
        eventType: 'bill_reopened',
        actor: 'user',
        accountId: updated.accountId,
        metadata: { kind: 'bill_reopened', billId: updated.id },
      });
    }
  });
}

async function setStatus(bill: Bill, status: BillStatus, eventType: 'bill_dismissed' | 'bill_reopened'): Promise<Bill> {
  const updated: Bill = { ...bill, status, updatedAt: new Date().toISOString() };
  await getDatabase().transaction(async tx => {
    await upsertTx(tx, updated);
    await auditRepository.insert(tx, {
      eventType,
      actor: 'user',
      accountId: updated.accountId,
      metadata:
        eventType === 'bill_dismissed'
          ? { kind: 'bill_dismissed', billId: updated.id }
          : { kind: 'bill_reopened', billId: updated.id },
    });
  });
  return updated;
}

async function dismiss(bill: Bill): Promise<Bill> {
  return setStatus(bill, 'dismissed', 'bill_dismissed');
}

async function undismiss(bill: Bill): Promise<Bill> {
  return setStatus(bill, 'open', 'bill_reopened');
}

/** The year-month key of a statement (its statement date, else its due date). */
function periodKey(bill: Pick<Bill, 'statementDate' | 'dueDate'>): string | null {
  const anchor = bill.statementDate ?? bill.dueDate;
  if (!anchor) return null;
  const d = new Date(anchor);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export interface SmsBillInput {
  accountId: string | null;
  kind: BillKind;
  payee: string;
  amountDueMinor: number;
  minDueMinor: number | null;
  statementDate: string | null;
  dueDate: string | null;
  sourceHash: string | null;
}

export type SmsBillOutcome = 'created' | 'updated' | 'duplicate';

/**
 * D-d: an SMS bill / statement / future-debit notice becomes an OPEN bill.
 * The same SMS read twice (same content hash) is one bill — a deduped read
 * does nothing. A newer statement for the same account + statement period
 * UPDATES the existing open bill instead of adding one. Never a transaction,
 * never touches balances.
 */
async function ingestSmsBill(input: SmsBillInput): Promise<SmsBillOutcome> {
  const existing = await listAll();
  // Dedupe: the identical SMS (same salted content hash) is one bill.
  if (input.sourceHash && existing.some(b => b.sourceHash != null && b.sourceHash === input.sourceHash)) {
    return 'duplicate';
  }
  // Statement update: an open SMS bill of the same kind on the same account in
  // the same statement period is refreshed, not duplicated.
  const period = periodKey(input);
  const sameBill =
    input.accountId != null && period != null
      ? existing.find(
          b =>
            b.status === 'open' &&
            b.source === 'sms' &&
            b.kind === input.kind &&
            b.accountId === input.accountId &&
            periodKey(b) === period,
        )
      : undefined;
  if (sameBill) {
    const now = new Date().toISOString();
    const updated: Bill = {
      ...sameBill,
      amountDueMinor: input.amountDueMinor,
      minDueMinor: input.minDueMinor,
      statementDate: input.statementDate ?? sameBill.statementDate,
      dueDate: input.dueDate ?? sameBill.dueDate,
      payee: input.payee,
      sourceHash: input.sourceHash ?? sameBill.sourceHash,
      updatedAt: now,
    };
    await getDatabase().transaction(async tx => {
      await upsertTx(tx, updated);
      await auditRepository.insert(tx, {
        eventType: 'bill_updated',
        actor: 'system',
        accountId: updated.accountId,
        metadata: { kind: 'bill_updated', billId: updated.id, fields: ['amountDueMinor', 'dueDate'] },
      });
    });
    return 'updated';
  }
  await create({
    accountId: input.accountId,
    kind: input.kind,
    payee: input.payee,
    amountDueMinor: input.amountDueMinor,
    minDueMinor: input.minDueMinor,
    statementDate: input.statementDate,
    dueDate: input.dueDate,
    source: 'sms',
    sourceHash: input.sourceHash,
  });
  return 'created';
}

export const billRepository = {
  listAll,
  create,
  update,
  markPaid,
  reopen,
  reopenByPaidTransaction,
  dismiss,
  undismiss,
  ingestSmsBill,
};

export type { BillSource };
