import { getDatabase } from '../db/connection';
import type { AuditEventInput } from '../../domain/audit/audit.types';
import { Budget, SetBudgetInput } from '../../domain/budgets/budget.types';
import { asNullableString, asNumber, asString, SqlRow } from '../mappers/coerce';
import { auditRepository } from './audit.repository';
import { generateId } from '../../shared/utils/id';

/**
 * R5c budgets persistence (migration 13). A budget is a READ-ONLY overlay on
 * spend — setting / removing one writes ONLY the budgets table and ONE audit
 * row (D-f), never a balance or a transaction.
 *
 * Singleness (D-a) is enforced here, not by the index: at most one overall
 * budget (category_id NULL) and at most one per category_id. `setBudget` is an
 * upsert BY KEY — if a budget for that key exists it is updated in place, so a
 * set replaces and never duplicates.
 *
 * Rows hold ids, an enum period and an amount only — no category name, no SMS
 * text, no sender number.
 */

export function rowToBudget(row: SqlRow): Budget {
  return {
    id: asString(row.id),
    categoryId: asNullableString(row.category_id),
    amountMinor: asNumber(row.amount_minor),
    // Only 'monthly' is used now; the column keeps the door open (D-a).
    period: 'monthly',
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

const INSERT =
  `INSERT INTO budgets (id, category_id, amount_minor, period, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`;

function insertParams(budget: Budget): Array<string | number | null> {
  return [
    budget.id,
    budget.categoryId,
    budget.amountMinor,
    budget.period,
    budget.createdAt,
    budget.updatedAt,
  ];
}

async function listAll(): Promise<Budget[]> {
  const result = await getDatabase().execute('SELECT * FROM budgets ORDER BY created_at ASC');
  return result.rows.map(r => rowToBudget(r as SqlRow));
}

/** The existing budget for a key (null = overall), using the same NULL-aware match. */
function findByKey(budgets: ReadonlyArray<Budget>, categoryId: string | null): Budget | null {
  return budgets.find(b => b.categoryId === categoryId) ?? null;
}

function setAudit(budget: Budget): AuditEventInput {
  return {
    eventType: 'budget_set',
    actor: 'user',
    metadata: { kind: 'budget_set', categoryId: budget.categoryId, amountMinor: budget.amountMinor },
  };
}

/**
 * D-a: set-or-replace a budget by key. A new key inserts (budget_set); an
 * existing key updates the amount in place (budget_updated, field 'amountMinor').
 * Returns the saved budget.
 */
async function setBudget(input: SetBudgetInput): Promise<Budget> {
  const now = new Date().toISOString();
  const existing = findByKey(await listAll(), input.categoryId);
  if (existing) {
    if (existing.amountMinor === input.amountMinor) return existing;
    const updated: Budget = { ...existing, amountMinor: input.amountMinor, updatedAt: now };
    await getDatabase().transaction(async tx => {
      await tx.execute('UPDATE budgets SET amount_minor = ?, updated_at = ? WHERE id = ?', [
        updated.amountMinor,
        updated.updatedAt,
        updated.id,
      ]);
      await auditRepository.insert(tx, {
        eventType: 'budget_updated',
        actor: 'user',
        metadata: {
          kind: 'budget_updated',
          categoryId: updated.categoryId,
          amountMinor: updated.amountMinor,
          fields: ['amountMinor'],
        },
      });
    });
    return updated;
  }
  const budget: Budget = {
    id: generateId('budget'),
    categoryId: input.categoryId,
    amountMinor: input.amountMinor,
    period: 'monthly',
    createdAt: now,
    updatedAt: now,
  };
  await getDatabase().transaction(async tx => {
    // Defence in depth: clear any stray row for this key before inserting, so a
    // set can never leave two budgets for the same category / overall.
    if (budget.categoryId === null) {
      await tx.execute('DELETE FROM budgets WHERE category_id IS NULL');
    } else {
      await tx.execute('DELETE FROM budgets WHERE category_id = ?', [budget.categoryId]);
    }
    await tx.execute(INSERT, insertParams(budget));
    await auditRepository.insert(tx, setAudit(budget));
  });
  return budget;
}

/**
 * D-d: remove a budget (the 5 s Undo re-sets it). Writes a budget_deleted
 * audit and returns the removed budget so the caller can restore it exactly.
 */
async function removeBudget(budget: Budget): Promise<Budget> {
  await getDatabase().transaction(async tx => {
    await tx.execute('DELETE FROM budgets WHERE id = ?', [budget.id]);
    await auditRepository.insert(tx, {
      eventType: 'budget_deleted',
      actor: 'user',
      metadata: {
        kind: 'budget_deleted',
        categoryId: budget.categoryId,
        amountMinor: budget.amountMinor,
      },
    });
  });
  return budget;
}

export const budgetRepository = {
  listAll,
  setBudget,
  removeBudget,
};
