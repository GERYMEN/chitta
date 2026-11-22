import { getDatabase } from '../db/connection';
import { Person } from '../../domain/iou/iou.types';
import { asString, SqlRow } from '../mappers/coerce';
import { auditRepository, SqlExecutor } from './audit.repository';
import { generateId } from '../../shared/utils/id';

/**
 * R10 people persistence (migration 15). A person is a free-text name the user
 * typed (no contacts, no SMS). The audit row references the person by id only.
 */

export function rowToPerson(row: SqlRow): Person {
  return {
    id: asString(row.id),
    name: asString(row.name),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

export function newPerson(name: string, now = new Date().toISOString()): Person {
  return { id: generateId('person'), name: name.trim(), createdAt: now, updatedAt: now };
}

/** Insert one person + its 'iou_person_added' audit, on an open transaction. */
export async function insertPersonTx(tx: SqlExecutor, person: Person): Promise<void> {
  await tx.execute('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    person.id,
    person.name,
    person.createdAt,
    person.updatedAt,
  ]);
  await auditRepository.insert(tx, {
    eventType: 'iou_person_added',
    actor: 'user',
    metadata: { kind: 'iou_person_added', personId: person.id },
  });
}

async function listAll(): Promise<Person[]> {
  const result = await getDatabase().execute('SELECT * FROM people ORDER BY created_at ASC');
  return result.rows.map(r => rowToPerson(r as SqlRow));
}

/** Create one person (manual entry path) in its own transaction. */
async function create(name: string): Promise<Person> {
  const person = newPerson(name);
  await getDatabase().transaction(async tx => {
    await insertPersonTx(tx, person);
  });
  return person;
}

export const peopleRepository = { listAll, create };
