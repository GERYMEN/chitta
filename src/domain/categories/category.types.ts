export type CategoryKind = 'income' | 'expense' | 'both';

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  type: CategoryKind;
  icon: string;
  isSystem: boolean;
}
