import { getDatabase } from '../db/connection';
import { Category, CategoryKind } from '../../domain/categories/category.types';
import { rowToCategory } from '../mappers/category.mapper';
import { generateId } from '../../shared/utils/id';
import { AuditEventDraft } from '../../domain/audit/audit.types';
import { auditRepository } from './audit.repository';

export interface CreateCategoryInput {
  name: string;
  type: CategoryKind;
  icon: string;
  color: string;
}

export type CategoryPatch = Partial<Pick<Category, 'name' | 'icon' | 'color'>>;

async function listAll(): Promise<Category[]> {
  const result = await getDatabase().execute('SELECT * FROM categories ORDER BY id ASC');
  return result.rows.map(rowToCategory);
}

async function getById(id: string): Promise<Category | null> {
  const result = await getDatabase().execute('SELECT * FROM categories WHERE id = ?', [id]);
  return result.rows.length > 0 ? rowToCategory(result.rows[0]) : null;
}

/**
 * Custom categories only (system rows are seeded). Every write lands in ONE
 * `db.transaction` with its audit rows — both or neither.
 */
async function create(
  input: CreateCategoryInput,
  audit: (category: Category) => ReadonlyArray<AuditEventDraft>,
): Promise<Category> {
  const category: Category = {
    id: generateId('cat'),
    name: input.name.trim(),
    parentId: null,
    type: input.type,
    icon: input.icon,
    isSystem: false,
    archivedAt: null,
    color: input.color,
  };
  await getDatabase().transaction(async tx => {
    await tx.execute(
      'INSERT INTO categories (id, name, parent_id, type, icon, is_system, archived_at, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [category.id, category.name, null, category.type, category.icon, 0, null, category.color],
    );
    for (const draft of audit(category)) {
      await auditRepository.insert(tx, draft);
    }
  });
  return category;
}

async function update(
  id: string,
  patch: CategoryPatch,
  audit: ReadonlyArray<AuditEventDraft>,
): Promise<Category> {
  const existing = await getById(id);
  if (!existing) throw new Error(`Category not found: ${id}`);
  if (existing.isSystem) throw new Error('System categories cannot be changed');
  const updated: Category = {
    ...existing,
    ...patch,
    name: (patch.name ?? existing.name).trim(),
  };
  await getDatabase().transaction(async tx => {
    await tx.execute('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?', [
      updated.name,
      updated.icon,
      updated.color,
      id,
    ]);
    for (const draft of audit) {
      await auditRepository.insert(tx, draft);
    }
  });
  return updated;
}

/** Soft "delete": hidden from pickers; transactions keep the id + label. */
async function archive(id: string, audit: ReadonlyArray<AuditEventDraft>): Promise<Category> {
  const existing = await getById(id);
  if (!existing) throw new Error(`Category not found: ${id}`);
  if (existing.isSystem) throw new Error('System categories cannot be archived');
  const archivedAt = new Date().toISOString();
  await getDatabase().transaction(async tx => {
    await tx.execute('UPDATE categories SET archived_at = ? WHERE id = ?', [archivedAt, id]);
    for (const draft of audit) {
      await auditRepository.insert(tx, draft);
    }
  });
  return { ...existing, archivedAt };
}

export const categoryRepository = {
  listAll,
  getById,
  create,
  update,
  archive,
};
