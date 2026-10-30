import { getDatabase } from '../db/connection';
import { MerchantRule } from '../../domain/categories/category.types';
import { AuditEventInput } from '../../domain/audit/audit.types';
import { asString, SqlRow } from '../mappers/coerce';
import { auditRepository } from './audit.repository';

function rowToMerchantRule(row: SqlRow): MerchantRule {
  return {
    merchantKey: asString(row.merchant_key),
    categoryId: asString(row.category_id),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

async function listAll(): Promise<MerchantRule[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM merchant_rules ORDER BY merchant_key ASC',
  );
  return result.rows.map(rowToMerchantRule);
}

async function get(merchantKey: string): Promise<MerchantRule | null> {
  const result = await getDatabase().execute(
    'SELECT * FROM merchant_rules WHERE merchant_key = ?',
    [merchantKey],
  );
  return result.rows.length > 0 ? rowToMerchantRule(result.rows[0]) : null;
}

/**
 * Insert or re-point a rule; `created_at` survives a re-point. The audit row
 * lands in the same `db.transaction`.
 */
async function upsert(
  merchantKey: string,
  categoryId: string,
  audit: ReadonlyArray<AuditEventInput>,
): Promise<MerchantRule> {
  if (merchantKey === '') throw new Error('Empty merchant key');
  const now = new Date().toISOString();
  await getDatabase().transaction(async tx => {
    await tx.execute(
      'INSERT INTO merchant_rules (merchant_key, category_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(merchant_key) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at',
      [merchantKey, categoryId, now, now],
    );
    for (const draft of audit) {
      await auditRepository.insert(tx, draft);
    }
  });
  return { merchantKey, categoryId, createdAt: now, updatedAt: now };
}

async function remove(merchantKey: string, audit: ReadonlyArray<AuditEventInput>): Promise<void> {
  await getDatabase().transaction(async tx => {
    await tx.execute('DELETE FROM merchant_rules WHERE merchant_key = ?', [merchantKey]);
    for (const draft of audit) {
      await auditRepository.insert(tx, draft);
    }
  });
}

export const merchantRuleRepository = {
  listAll,
  get,
  upsert,
  delete: remove,
};
