import {
  canModifyCategory,
  categoryLabel,
  invertChanges,
  pickableCategories,
  rememberDecision,
  ruleApplyTargets,
  TRANSFER_CATEGORY_ID,
  UNCATEGORISED_ID,
  uncategorisedItems,
  visibleCategories,
  validateCategoryName,
} from '../category.rules';
import { Category } from '../category.types';
import { Transaction } from '../../transactions/transaction.types';

const cat = (overrides: Partial<Category>): Category => ({
  id: 'cat-x',
  name: 'X',
  parentId: null,
  type: 'expense',
  icon: 'shape-outline',
  isSystem: false,
  archivedAt: null,
  color: null,
  ...overrides,
});

const CATEGORIES: Category[] = [
  cat({ id: 'cat-food', name: 'Food & Dining', isSystem: true }),
  cat({ id: 'cat-salary', name: 'Salary & Wages', type: 'income', isSystem: true }),
  cat({ id: UNCATEGORISED_ID, name: 'Uncategorised', type: 'both', isSystem: true }),
  cat({ id: 'cat-qa', name: 'QA Category' }),
  cat({ id: 'cat-qa-old', name: 'QA Old', archivedAt: '2026-10-28T00:00:00.000Z' }),
  cat({ id: 'cat-qa-both', name: 'QA Both', type: 'both' }),
];

type Tx = Pick<Transaction, 'id' | 'accountId' | 'merchantName' | 'categoryId' | 'status'>;
const tx = (overrides: Partial<Tx>): Tx => ({
  id: 'txn-x',
  accountId: 'acc-qa',
  merchantName: 'QA-Merchant-08',
  categoryId: UNCATEGORISED_ID,
  status: 'pending',
  ...overrides,
});

describe('pickableCategories (pickers exclude archived)', () => {
  it('expense picker: no archived, no income-only, includes type-neutral ones', () => {
    const ids = pickableCategories(CATEGORIES, 'expense').map(c => c.id);
    expect(ids).toEqual(['cat-food', UNCATEGORISED_ID, 'cat-qa', 'cat-qa-both']);
    expect(ids).not.toContain('cat-qa-old');
  });

  it('income picker', () => {
    expect(pickableCategories(CATEGORIES, 'income').map(c => c.id)).toEqual([
      'cat-salary',
      UNCATEGORISED_ID,
      'cat-qa-both',
    ]);
  });

  it("keeps the item's current archived category listed, but only that one", () => {
    const ids = pickableCategories(CATEGORIES, 'expense', { keepId: 'cat-qa-old' }).map(c => c.id);
    expect(ids).toContain('cat-qa-old');
    expect(pickableCategories(CATEGORIES, 'income', { keepId: 'cat-qa-old' }).map(c => c.id)).not.toContain(
      'cat-qa-old',
    );
  });

  it('quick-assign can hide Uncategorised', () => {
    const ids = pickableCategories(CATEGORIES, 'expense', { includeUncategorised: false }).map(c => c.id);
    expect(ids).not.toContain(UNCATEGORISED_ID);
  });
});

describe('labels and permissions', () => {
  it('archived categories keep their label with "(archived)"', () => {
    expect(categoryLabel(CATEGORIES[4])).toBe('QA Old (archived)');
    expect(categoryLabel(CATEGORIES[3])).toBe('QA Category');
    expect(categoryLabel(undefined)).toBe('Uncategorised');
  });

  it('system categories cannot be renamed or archived', () => {
    expect(canModifyCategory(CATEGORIES[0])).toBe(false);
    expect(canModifyCategory(CATEGORIES[2])).toBe(false);
    expect(canModifyCategory(CATEGORIES[3])).toBe(true);
  });

  it('validates names: empty, too long, case-insensitive duplicate (self allowed)', () => {
    expect(validateCategoryName('  ', CATEGORIES)).toBe('empty');
    expect(validateCategoryName('x'.repeat(31), CATEGORIES)).toBe('too-long');
    expect(validateCategoryName(' qa category ', CATEGORIES)).toBe('duplicate');
    expect(validateCategoryName('QA Category', CATEGORIES, 'cat-qa')).toBeNull();
    expect(validateCategoryName('QA Pets', CATEGORIES)).toBeNull();
  });
});

describe('uncategorisedItems (nudge count)', () => {
  it('counts pending + approved only', () => {
    const items = uncategorisedItems([
      tx({ id: 'a', status: 'pending' }),
      tx({ id: 'b', status: 'approved' }),
      tx({ id: 'c', status: 'rejected' }),
      tx({ id: 'd', status: 'approved', categoryId: 'cat-food' }),
    ]);
    expect(items.map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('ruleApplyTargets / invertChanges', () => {
  const list: Tx[] = [
    tx({ id: 'self', categoryId: 'cat-food' }),
    tx({ id: 'other-pending', categoryId: UNCATEGORISED_ID }),
    tx({ id: 'other-approved', status: 'approved', categoryId: 'cat-qa', merchantName: 'qa merchant 08@okqa' }),
    tx({ id: 'already', categoryId: 'cat-food' }),
    tx({ id: 'rejected', status: 'rejected' }),
    tx({ id: 'different', merchantName: 'QA-Merchant-07' }),
  ];

  it('targets other pending/approved items with the same key and a different category', () => {
    const changes = ruleApplyTargets(list, 'qa merchant 08', 'cat-food', 'self');
    expect(changes).toEqual([
      { id: 'other-pending', accountId: 'acc-qa', fromCategoryId: UNCATEGORISED_ID, toCategoryId: 'cat-food' },
      { id: 'other-approved', accountId: 'acc-qa', fromCategoryId: 'cat-qa', toCategoryId: 'cat-food' },
    ]);
  });

  it('empty key never targets anything', () => {
    expect(ruleApplyTargets(list, '', 'cat-food', null)).toEqual([]);
  });

  it('invertChanges restores each exact previous id', () => {
    const changes = ruleApplyTargets(list, 'qa merchant 08', 'cat-food', 'self');
    expect(invertChanges(changes)).toEqual([
      { id: 'other-pending', accountId: 'acc-qa', fromCategoryId: 'cat-food', toCategoryId: UNCATEGORISED_ID },
      { id: 'other-approved', accountId: 'acc-qa', fromCategoryId: 'cat-food', toCategoryId: 'cat-qa' },
    ]);
  });
});

describe('rememberDecision', () => {
  it('asks "Always?" when there is no rule or a different one', () => {
    expect(rememberDecision('qa merchant 08', 'cat-food', undefined)).toBe('ask-always');
    expect(rememberDecision('qa merchant 08', 'cat-food', 'cat-qa')).toBe('ask-always');
  });

  it('skips straight to apply when the rule already says so', () => {
    expect(rememberDecision('qa merchant 08', 'cat-food', 'cat-food')).toBe('offer-apply-only');
  });

  it('never asks for Uncategorised or an empty merchant', () => {
    expect(rememberDecision('qa merchant 08', UNCATEGORISED_ID, undefined)).toBe('none');
    expect(rememberDecision('', 'cat-food', undefined)).toBe('none');
  });
});

describe('R3a: hidden system Transfer category', () => {
  const transferCat = cat({ id: TRANSFER_CATEGORY_ID, name: 'Transfer', type: 'both', isSystem: true });
  const food = cat({ id: 'cat-food', name: 'Food' });
  const uncategorised = cat({ id: UNCATEGORISED_ID, name: 'Uncategorised', type: 'both', isSystem: true });
  const all = [food, uncategorised, transferCat];

  it('no picker ever offers cat-transfer (any type, even as keepId)', () => {
    for (const type of ['expense', 'income', 'transfer'] as const) {
      expect(pickableCategories(all, type).map(c => c.id)).not.toContain(TRANSFER_CATEGORY_ID);
      expect(
        pickableCategories(all, type, { keepId: TRANSFER_CATEGORY_ID }).map(c => c.id),
      ).not.toContain(TRANSFER_CATEGORY_ID);
    }
    expect(visibleCategories(all).map(c => c.id)).toEqual(['cat-food', UNCATEGORISED_ID]);
  });

  it('transfers and transfer twins never count as Uncategorised', () => {
    const items = uncategorisedItems([
      { id: 'a', categoryId: UNCATEGORISED_ID, status: 'pending', type: 'expense' as const },
      { id: 'b', categoryId: UNCATEGORISED_ID, status: 'approved', type: 'transfer' as const },
      { id: 'c', categoryId: UNCATEGORISED_ID, status: 'pending', type: 'income' as const, linkKind: 'transfer_twin' as const },
      { id: 'd', categoryId: TRANSFER_CATEGORY_ID, status: 'approved', type: 'transfer' as const },
    ]);
    expect(items.map(t => t.id)).toEqual(['a']);
  });

  it('a merchant rule never re-files a transfer', () => {
    const rows = [
      { id: 't', accountId: 'a', merchantName: 'QA-Merchant-09', categoryId: TRANSFER_CATEGORY_ID, status: 'approved' as const, type: 'transfer' as const },
      { id: 'e', accountId: 'a', merchantName: 'QA-Merchant-09', categoryId: 'cat-x', status: 'approved' as const, type: 'expense' as const },
    ];
    expect(ruleApplyTargets(rows, 'qa merchant 09', 'cat-food', null).map(c => c.id)).toEqual(['e']);
  });
});
