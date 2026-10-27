/**
 * Jest manual mock for @op-engineering/op-sqlite. The real package reads
 * `NativeModules.OPSQLite` at import time, which is undefined under the
 * react-native jest preset. This stub keeps app-level tests (which pull the
 * store -> repositories -> connection -> op-sqlite import chain) from
 * crashing, returning empty result sets for every query.
 */
const emptyResult = () => ({ insertId: 0, rowsAffected: 0, rows: [] });

const tx = {
  execute: jest.fn(async () => emptyResult()),
  commit: () => emptyResult(),
  rollback: () => emptyResult(),
};

const db = {
  execute: jest.fn(async () => emptyResult()),
  executeSync: () => emptyResult(),
  transaction: jest.fn(async fn => fn(tx)),
  close: jest.fn(),
  closeAsync: jest.fn(async () => {}),
};

export const open = jest.fn(() => db);
export const openAsync = jest.fn(async () => db);
