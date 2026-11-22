import { getDatabase } from '../db/connection';
import { Tag } from '../../domain/tags/tag.types';
import { tagKey, validateTagName } from '../../domain/tags/tag.rules';
import { asString, SqlRow } from '../mappers/coerce';
import { auditRepository } from './audit.repository';
import { generateId } from '../../shared/utils/id';

/**
 * R11 custom-tag persistence (migration 16). Names are user content: audit
 * rows reference a tag by id only. A name is unique by its normalized key, so
 * '#Food' and 'food' are one tag (display keeps the first casing typed).
 */

export function rowToTag(row: SqlRow): Tag {
  return {
    id: asString(row.id),
    name: asString(row.name),
    nameKey: asString(row.name_key),
    createdAt: asString(row.created_at),
  };
}

async function listTags(): Promise<Tag[]> {
  const result = await getDatabase().execute('SELECT * FROM tags ORDER BY name_key ASC');
  return result.rows.map(r => rowToTag(r as SqlRow));
}

/** transactionId -> tag ids. */
async function listLinks(): Promise<Record<string, string[]>> {
  const result = await getDatabase().execute(
    'SELECT transaction_id, tag_id FROM transaction_tags ORDER BY rowid ASC',
  );
  const out: Record<string, string[]> = {};
  for (const row of result.rows) {
    const id = asString((row as SqlRow).transaction_id);
    (out[id] ??= []).push(asString((row as SqlRow).tag_id));
  }
  return out;
}

export interface AttachResult {
  tag: Tag;
  /** false when the transaction already had this tag (nothing written). */
  added: boolean;
}

/**
 * Attach a custom tag by name (upsert by key) + 'tag_added' audit, in ONE
 * transaction. Returns null for an invalid (empty / too long) name.
 */
async function attach(
  transactionId: string,
  accountId: string | null,
  rawName: string,
  now = new Date().toISOString(),
): Promise<AttachResult | null> {
  const name = validateTagName(rawName);
  if (name === null) return null;
  const key = tagKey(name);
  let result: AttachResult | null = null;
  await getDatabase().transaction(async tx => {
    const found = await tx.execute('SELECT * FROM tags WHERE name_key = ?', [key]);
    let tag: Tag;
    if (found.rows.length > 0) {
      tag = rowToTag(found.rows[0] as SqlRow);
    } else {
      tag = { id: generateId('tag'), name, nameKey: key, createdAt: now };
      await tx.execute('INSERT INTO tags (id, name, name_key, created_at) VALUES (?, ?, ?, ?)', [
        tag.id,
        tag.name,
        tag.nameKey,
        tag.createdAt,
      ]);
    }
    const link = await tx.execute(
      'SELECT 1 FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?',
      [transactionId, tag.id],
    );
    if (link.rows.length > 0) {
      result = { tag, added: false };
      return;
    }
    await tx.execute('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', [
      transactionId,
      tag.id,
    ]);
    await auditRepository.insert(tx, {
      eventType: 'tag_added',
      actor: 'user',
      metadata: { kind: 'tag_added', tagId: tag.id, transactionId },
      transactionId,
      accountId,
    });
    result = { tag, added: true };
  });
  return result;
}

/** Detach a tag from one transaction + 'tag_removed' audit. False if it was not attached. */
async function detach(
  transactionId: string,
  accountId: string | null,
  tagId: string,
): Promise<boolean> {
  let removed = false;
  await getDatabase().transaction(async tx => {
    const res = await tx.execute(
      'DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?',
      [transactionId, tagId],
    );
    if (!res.rowsAffected) return;
    removed = true;
    await auditRepository.insert(tx, {
      eventType: 'tag_removed',
      actor: 'user',
      metadata: { kind: 'tag_removed', tagId, transactionId },
      transactionId,
      accountId,
    });
  });
  return removed;
}

export const tagRepository = { listTags, listLinks, attach, detach };
