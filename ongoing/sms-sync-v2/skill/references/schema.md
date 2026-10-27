# Schema additions (target shape)

Apply via versioned migrations in the existing persistence layer. Column names may be
adapted to match existing conventions in the repo — keep the semantics.

```sql
-- D3: explicit user decisions only. No row = undecided.
CREATE TABLE IF NOT EXISTS account_suggestion_decisions (
  bank_canonical     TEXT    NOT NULL,
  account_kind       TEXT    NOT NULL,             -- bank | credit_card | ...
  last_four          TEXT    NOT NULL DEFAULT '',  -- '' = unidentified (not NULL!)
  decision           TEXT    NOT NULL
                     CHECK (decision IN ('added','linked','ignored','deleted')),
  account_id         TEXT,                         -- set for added/linked/deleted
  normalizer_version INTEGER NOT NULL,
  decided_at         INTEGER NOT NULL,             -- epoch ms
  PRIMARY KEY (bank_canonical, account_kind, last_four)
);

-- D3: aggregates only, rebuildable from a full rescan. Never SMS content.
CREATE TABLE IF NOT EXISTS account_suggestion_candidates (
  bank_canonical     TEXT    NOT NULL,
  account_kind       TEXT    NOT NULL,
  last_four          TEXT    NOT NULL DEFAULT '',
  txn_count          INTEGER NOT NULL,
  first_seen_at      INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  normalizer_version INTEGER NOT NULL,
  PRIMARY KEY (bank_canonical, account_kind, last_four)
);

-- D2: resumable scans and backfills.
CREATE TABLE IF NOT EXISTS sms_sync_runs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('initial','incremental','backfill')),
  range_from    INTEGER NOT NULL,
  range_to      INTEGER,                 -- NULL = up to now
  cursor_date   INTEGER,
  cursor_sms_id INTEGER,
  status        TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER
);

-- D7: balance anchor. NULL = "Set balance".
ALTER TABLE accounts ADD COLUMN balance_anchor_minor INTEGER;
ALTER TABLE accounts ADD COLUMN balance_anchor_at    INTEGER;

-- D10: soft delete.
ALTER TABLE accounts ADD COLUMN deleted_at INTEGER;

-- D8: bulk approve batches.
ALTER TABLE transactions ADD COLUMN bulk_batch_id TEXT;

-- D2 / D9: dedup + period queries.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_source_hash ON transactions(source_reference_hash);
CREATE INDEX IF NOT EXISTS ix_tx_status_date  ON transactions(status, occurred_at);
CREATE INDEX IF NOT EXISTS ix_tx_account_date ON transactions(account_id, occurred_at);
```

## app_settings keys

| key | meaning |
|-----|---------|
| `sms_scan_scope` | `30d` \| `90d` \| `install` \| `all` (display only) |
| `sms_scan_from` | absolute epoch ms resolved once at selection time (`0` for all) |
| `first_launch_at` | epoch ms, written on first launch (used by `install`) |
| `sms_parser_normalizer_version` | current normalizer version |

## Repository rules

- Accounts: `listActiveAccounts()` (deleted_at IS NULL) and `listAllAccounts()`.
  Pickers use active; transaction labeling uses all.
- All SQL parameterized (`?` placeholders). No string-built SQL.
- Multi-row writes (chunk import, bulk approve, delete/restore) in one `db.transaction`.
- If the unique index on `source_reference_hash` fails to create because duplicates
  already exist, stop and report — do not delete rows to make it pass.
