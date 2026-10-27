import { Category } from '../../domain/categories/category.types';

export const categoryFixtures: Category[] = [
  { id: 'cat-food', name: 'Food & Dining', parentId: null, type: 'expense', icon: 'silverware-fork-knife', isSystem: true },
  { id: 'cat-shopping', name: 'Shopping', parentId: null, type: 'expense', icon: 'shopping-outline', isSystem: true },
  { id: 'cat-transport', name: 'Transport', parentId: null, type: 'expense', icon: 'car-outline', isSystem: true },
  { id: 'cat-coffee', name: 'F&B', parentId: null, type: 'expense', icon: 'coffee-outline', isSystem: true },
  { id: 'cat-salary', name: 'Salary & Wages', parentId: null, type: 'income', icon: 'bank-outline', isSystem: true },
  { id: 'cat-freelance', name: 'Consulting', parentId: null, type: 'income', icon: 'laptop', isSystem: true },
];

export function categoryById(id: string): Category | undefined {
  return categoryFixtures.find(category => category.id === id);
}
