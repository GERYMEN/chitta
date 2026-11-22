import { tagRepository } from '../tag.repository';
import { transactionRepository } from '../transaction.repository';
import { getDatabase } from '../../db/connection';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../test/sqliteDb';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const describeSql = sqliteAvailable() ? describe : describe.skip;

describeSql('R11 tag + receipt repositories (real SQLite)', () => {
  let t: TestSqlite;
  beforeEach(() => {
    t = openTestSqlite();
    migrateTo(t, 16);
    mockGetDatabase.mockReturnValue(t.db as never);
  });
  afterEach(() => {
    t.close();
    mockGetDatabase.mockReset();
  });

  const audits = (type: string) =>
    t.rows('audit_events').filter(r => r.event_type === type);

  it('attach creates a tag once per normalized key and links it; audit has ids only', async () => {
    const a = await tagRepository.attach('qa-t1', 'qa-a1', '#QA Trip');
    const b = await tagRepository.attach('qa-t2', 'qa-a1', 'qa trip');
    expect(a?.added).toBe(true);
    expect(b?.tag.id).toBe(a?.tag.id);
    expect(t.rows('tags')).toHaveLength(1);
    expect(t.rows('tags')[0].name).toBe('QA Trip');
    expect(t.rows('transaction_tags')).toHaveLength(2);
    const rows = audits('tag_added');
    expect(rows).toHaveLength(2);
    expect(String(rows[0].metadata_json)).not.toMatch(/QA Trip/i);
    expect(JSON.parse(String(rows[0].metadata_json))).toEqual({
      kind: 'tag_added',
      tagId: a?.tag.id,
      transactionId: 'qa-t1',
    });
  });

  it('a duplicate attach writes nothing; invalid names are refused', async () => {
    await tagRepository.attach('qa-t1', null, 'qa');
    const again = await tagRepository.attach('qa-t1', null, ' #QA ');
    expect(again?.added).toBe(false);
    expect(t.rows('transaction_tags')).toHaveLength(1);
    expect(audits('tag_added')).toHaveLength(1);
    expect(await tagRepository.attach('qa-t1', null, ' # ')).toBeNull();
  });

  it('detach removes the link, audits once, keeps the tag; listLinks maps ids', async () => {
    const a = await tagRepository.attach('qa-t1', null, 'qa');
    expect(await tagRepository.listLinks()).toEqual({ 'qa-t1': [a!.tag.id] });
    expect(await tagRepository.detach('qa-t1', null, a!.tag.id)).toBe(true);
    expect(await tagRepository.detach('qa-t1', null, a!.tag.id)).toBe(false);
    expect(t.rows('transaction_tags')).toHaveLength(0);
    expect(t.rows('tags')).toHaveLength(1);
    expect(audits('tag_removed')).toHaveLength(1);
  });

  it('deleting a transaction removes its tag links', async () => {
    await tagRepository.attach('qa-t1', null, 'qa');
    await transactionRepository.delete('qa-t1', [], null);
    expect(t.rows('transaction_tags')).toHaveLength(0);
  });

  it('setReceiptPath writes the file name only and audits with the transaction id only', async () => {
    t.raw
      .prepare(
        `INSERT INTO transactions (id,type,status,amount_minor,currency,merchant_name,category_id,account_id,payment_method,occurred_at,detected_at,source_type,created_at,updated_at)
         VALUES ('qa-t1','expense','approved',100,'INR','QA','c','a','upi','2026-01-01','2026-01-01','manual','2026-01-01','2026-01-01')`,
      )
      .run();
    await transactionRepository.setReceiptPath('qa-t1', 'a', 'qa-t1.jpg');
    expect((await transactionRepository.getById('qa-t1'))?.receiptPath).toBe('qa-t1.jpg');
    await transactionRepository.setReceiptPath('qa-t1', 'a', null);
    expect((await transactionRepository.getById('qa-t1'))?.receiptPath).toBeNull();
    const added = audits('receipt_added')[0];
    expect(JSON.parse(String(added.metadata_json))).toEqual({ kind: 'receipt_added', transactionId: 'qa-t1' });
    expect(String(added.metadata_json)).not.toMatch(/jpg/);
    expect(audits('receipt_removed')).toHaveLength(1);
  });
});
