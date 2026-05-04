"""
VectorStore — sqlite-vec backed semantic memory.
Stores embeddings for mission phases, skill patterns, and evolution outcomes.
Enables top-k semantic retrieval at Intake and Plan stages.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import sqlite_vec

EMBEDDING_DIM = 384  # matches all-MiniLM-L6-v2; change if using different model

# Module-level cache: one VectorStore per resolved db_path string.
_STORE_CACHE: dict[str, "VectorStore"] = {}


def get_vector_store(db_path: str | Path) -> "VectorStore":
    """Return a cached VectorStore for *db_path*, creating it on first access."""
    key = str(Path(db_path).resolve())
    if key not in _STORE_CACHE:
        _STORE_CACHE[key] = VectorStore(db_path)
    return _STORE_CACHE[key]


class VectorStore:
    def __init__(self, db_path: str | Path) -> None:
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.enable_load_extension(True)
        sqlite_vec.load(self.conn)
        self.conn.enable_load_extension(False)
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS mission_embeddings USING vec0(
                embedding float[{dim}]
            );
            CREATE TABLE IF NOT EXISTS mission_memory (
                rowid       INTEGER PRIMARY KEY,
                mission_id  TEXT NOT NULL,
                stage       TEXT NOT NULL,
                summary     TEXT NOT NULL,
                outcome     TEXT,
                ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            """.format(dim=EMBEDDING_DIM)
        )
        self.conn.commit()

    def embed(self, text: str) -> list[float]:
        """
        Local embedding via sentence-transformers (all-MiniLM-L6-v2).
        Falls back to a zero vector on import failure (graceful degradation).
        """
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]

            # Cache model at class level to avoid repeated loads.
            if not hasattr(VectorStore, "_model"):
                VectorStore._model = SentenceTransformer("all-MiniLM-L6-v2")
            return VectorStore._model.encode(text).tolist()  # type: ignore[union-attr]
        except ImportError:
            return [0.0] * EMBEDDING_DIM

    def store(
        self,
        mission_id: str,
        stage: str,
        summary: str,
        outcome: str | None = None,
    ) -> None:
        """Embed *summary* and persist the row to both tables atomically."""
        vec = self.embed(summary)
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO mission_memory (mission_id, stage, summary, outcome)"
                " VALUES (?,?,?,?)",
                (mission_id, stage, summary, outcome),
            )
            rowid = cur.lastrowid
            self.conn.execute(
                "INSERT INTO mission_embeddings (rowid, embedding) VALUES (?, ?)",
                (rowid, json.dumps(vec)),  # sqlite-vec accepts JSON array
            )

    def retrieve(self, query: str, k: int = 5) -> list[dict[str, Any]]:
        """Return top-k semantically similar mission memories."""
        q_vec = self.embed(query)
        rows = self.conn.execute(
            """
            SELECT mm.mission_id, mm.stage, mm.summary, mm.outcome, mm.ts,
                   distance
            FROM mission_embeddings
            JOIN mission_memory mm ON mm.rowid = mission_embeddings.rowid
            WHERE embedding MATCH ?
              AND k = ?
            ORDER BY distance
            """,
            (json.dumps(q_vec), k),
        ).fetchall()
        return [
            {
                "mission_id": r[0],
                "stage": r[1],
                "summary": r[2],
                "outcome": r[3],
                "ts": r[4],
                "distance": r[5],
            }
            for r in rows
        ]
