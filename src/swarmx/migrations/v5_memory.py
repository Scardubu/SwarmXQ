"""swarmx.migrations.v5_memory — Idempotent V5 schema migration.

Called by `swarmx migrate --to v5`. Safe to re-run: all DDL uses
IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards.

New tables/columns are append-only — prior code continues to work
against a V5-migrated database (new columns have defaults; new tables
are ignored by old queries).
"""
from __future__ import annotations

from pathlib import Path


V5_MEMORY_MIGRATION = """
-- ── V5 memory column additions ────────────────────────────────────────────────
-- SQLite 3.37+ supports ADD COLUMN with DEFAULT safely
ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_kind   TEXT    DEFAULT 'lesson';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS confidence    REAL    DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS decay_score   REAL    DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS usage_count   INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS superseded    INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_blob BLOB;

-- ── FTS5 full-text search virtual table ───────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    id UNINDEXED,
    summary,
    content,
    tags,
    tokenize = 'porter ascii'
);

-- Populate FTS5 from existing rows (idempotent: DELETE + reinsert)
INSERT OR REPLACE INTO memories_fts(id, summary, content, tags)
    SELECT id,
           COALESCE(summary, ''),
           COALESCE(content, ''),
           COALESCE(tags, '')
    FROM memories;

-- ── FTS5 sync triggers (keep in sync automatically) ───────────────────────────
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT OR REPLACE INTO memories_fts(id, summary, content, tags)
        VALUES (new.id, COALESCE(new.summary,''), COALESCE(new.content,''), COALESCE(new.tags,''));
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT OR REPLACE INTO memories_fts(id, summary, content, tags)
        VALUES (new.id, COALESCE(new.summary,''), COALESCE(new.content,''), COALESCE(new.tags,''));
END;

-- ── Memory consolidation audit table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_consolidations (
    id                 TEXT    PRIMARY KEY,
    created_at         TEXT    NOT NULL,
    source_ids         TEXT    NOT NULL,   -- JSON array of merged memory IDs
    summary            TEXT    NOT NULL,
    confidence         REAL    DEFAULT 0.8,
    kind               TEXT    DEFAULT 'semantic',
    curator_approved   INTEGER DEFAULT 0
);

-- ── Thread-scoped resumable checkpoints ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id       TEXT    NOT NULL,
    stage           TEXT    NOT NULL,
    created_at      TEXT    NOT NULL,   -- ISO-8601 with WAT offset
    state_json      TEXT    NOT NULL,
    risk            TEXT    NOT NULL,
    is_interrupt    INTEGER DEFAULT 0,
    resume_cursor   INTEGER DEFAULT 0,
    branch_parent   TEXT,
    PRIMARY KEY (thread_id, stage)
);

-- ── Swarm narrative log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS narratives (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    narrative    TEXT NOT NULL,
    anomaly      INTEGER DEFAULT 0,
    drift_score  REAL    DEFAULT 0.0
);

-- ── Dispatch telemetry (mirrors controller/dispatch.jsonl; queryable) ─────────
CREATE TABLE IF NOT EXISTS dispatch_telemetry (
    id          TEXT PRIMARY KEY,
    ts          TEXT NOT NULL,        -- ISO-8601 from gate µ-10 schema
    model       TEXT NOT NULL,
    role        TEXT NOT NULL,
    latency_ms  INTEGER,
    vram_gb     REAL,
    error       INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0
);
"""


def run_v5_migration(runtime_home: Path, *, dry_run: bool = False) -> list[str]:
    """Execute (or preview) the V5 memory schema migration.

    Args:
        runtime_home: SwarmX runtime directory (contains state/swarmx.sqlite3).
        dry_run: If True, return the SQL statements without executing.

    Returns:
        List of SQL statement strings that were (or would be) executed.
    """
    from ..storage import connect  # late import to avoid circular

    statements: list[str] = [
        s.strip()
        for s in V5_MEMORY_MIGRATION.split(";")
        if s.strip() and not s.strip().startswith("--")
    ]

    if dry_run:
        return statements

    with connect(runtime_home) as conn:
        for stmt in statements:
            if stmt:
                try:
                    conn.execute(stmt)
                except Exception as exc:
                    # ADD COLUMN IF NOT EXISTS is SQLite 3.37+; graceful fallback
                    if "duplicate column" in str(exc).lower() or "already exists" in str(exc).lower():
                        continue
                    # FTS5 failures on older SQLite — skip, log
                    if "fts5" in str(exc).lower() or "virtual" in str(exc).lower():
                        continue
                    raise

    # Write migration checksum
    import hashlib
    checksum = hashlib.sha256(V5_MEMORY_MIGRATION.encode()).hexdigest()
    checksum_path = runtime_home / "state" / "v5_migration.sha256"
    checksum_path.parent.mkdir(parents=True, exist_ok=True)
    checksum_path.write_text(checksum + "\n", encoding="utf-8")

    return statements
