# SwarmX V3 Production Bundle

SwarmX V3 upgrades the control plane with:

- durable SQLite-backed runtime storage
- append-only event journaling with live dashboard streaming
- background worker support for queued jobs
- memory graph and semantic memory search
- richer metrics and queue reconciliation

The bundle keeps the existing JSONL artifacts for compatibility while mirroring them into the durable store for production use.
