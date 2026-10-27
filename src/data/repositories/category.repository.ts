import { getDatabase } from '../db/connection';
import { Category } from '../../domain/categories/category.types';
import { rowToCategory } from '../mappers/category.mapper';

async function listAll(): Promise<Category[]> {
  const result = await getDatabase().execute('SELECT * FROM categories ORDER BY id ASC');
  return result.rows.map(rowToCategory);
}

export const categoryRepository = {
  listAll,
};
