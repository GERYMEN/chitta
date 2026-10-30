import { open, DB } from '@op-engineering/op-sqlite';
import { SCHEMA_STATEMENTS } from './schema';
import { runNumberedMigrations } from './migrations';

let db: DB | null = null;

/**
 * Lazily open the singleton database. Called once; subsequent calls return
 * the same connection. `open({ name })` defaults the location to the app's
 * documents directory.
 */
export function getDatabase(): DB {
  if (!db) {
    db = open({ name: 'tracker.db' });
  }
  return db;
}

const SYSTEM_CATEGORIES = [
  { id: 'cat-food', name: 'Food & Dining', type: 'expense', icon: 'silverware-fork-knife' },
  { id: 'cat-shopping', name: 'Shopping', type: 'expense', icon: 'shopping-outline' },
  { id: 'cat-transport', name: 'Transport', type: 'expense', icon: 'car-outline' },
  { id: 'cat-coffee', name: 'F&B', type: 'expense', icon: 'coffee-outline' },
  { id: 'cat-salary', name: 'Salary & Wages', type: 'income', icon: 'bank-outline' },
  { id: 'cat-freelance', name: 'Consulting', type: 'income', icon: 'laptop' },
];

/**
 * Idempotent migration + seed. Safe to call on every app start: tables use
 * `CREATE TABLE IF NOT EXISTS`, and system categories are only inserted when
 * the categories table is empty (so restarts never duplicate them). The
 * system "Uncategorised" row comes from numbered migration 5.
 */
export async function runMigrations(): Promise<void> {
  const database = getDatabase();

  for (const statement of SCHEMA_STATEMENTS) {
    await database.execute(statement);
  }

  // Seed BEFORE the numbered migrations: migration 5 inserts the
  // Uncategorised row, and the seed only runs on an empty table — after it,
  // a fresh install would otherwise never get the six base categories.
  await seedSystemCategories(database);

  await runNumberedMigrations(database);
}

async function seedSystemCategories(database: DB): Promise<void> {
  const result = await database.execute('SELECT COUNT(*) AS count FROM categories');
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) return;

  await database.transaction(async tx => {
    for (const category of SYSTEM_CATEGORIES) {
      await tx.execute(
        `INSERT INTO categories (id, name, parent_id, type, icon, is_system) VALUES (?, ?, ?, ?, ?, ?)`,
        [category.id, category.name, null, category.type, category.icon, 1],
      );
    }
  });
}
