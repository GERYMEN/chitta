import { Category } from '../../domain/categories/category.types';
import {
  asBoolean,
  asNullableString,
  asString,
  SqlRow,
  SqlWriteRow,
} from './coerce';

export function rowToCategory(row: SqlRow): Category {
  return {
    id: asString(row.id),
    name: asString(row.name),
    parentId: asNullableString(row.parent_id),
    type: row.type as Category['type'],
    icon: asString(row.icon),
    isSystem: asBoolean(row.is_system),
  };
}

export function categoryToRow(category: Category): SqlWriteRow {
  return {
    id: category.id,
    name: category.name,
    parent_id: category.parentId,
    type: category.type,
    icon: category.icon,
    is_system: category.isSystem ? 1 : 0,
  };
}
