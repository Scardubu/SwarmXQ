# Release Checklist Template
# Version: 2026.04 · IEP-ELITE-MAX · v2.0
# Backward-compatible with all prior versions.

## Pre-release gates (block on any unchecked)
- [ ] Checksums regenerated — SHA-256 for all artifacts in CHECKSUMS.sha256.
- [ ] Manifests updated — MANIFEST.txt reflects current file tree.
- [ ] All tests passing — no skipped tests without documented justification.
- [ ] Fix Log drained — zero unresolved `[CRITICAL]` entries (μ-4 check passed).
- [ ] Rollback path documented AND manually verified in a dry run.
- [ ] Approval gate captured — human approval recorded for all medium+ risk changes.
- [ ] Blast radius confirmed ≤ original estimate — or scope correction issued.

## Artifact integrity
- [ ] All agent `.md` files contain `IEP-ELITE 2026.2` or later.
- [ ] `catalog.yaml` (agents) version field updated.
- [ ] `catalog.yaml` (skills) contains all three new IEP-ELITE skills.
- [ ] No existing triggers, agent names, or output contracts changed.
- [ ] `swarmx.defaults.yaml` version field bumped.

## Quality checks
- [ ] Island convergence probe (μ-5) did not fire on final release run.
- [ ] Confidence gate recorded ≥ HIGH on all release-critical outputs.
- [ ] Output Quality Gate (§15) passed on all three checks for release artifact.
- [ ] Handoff Contract Validator (§13) reported CLEAN for all inter-agent handoffs.

## Post-release
- [ ] Trace evidence attached to run record.
- [ ] Memory updated with release lesson (memory-note template used).
- [ ] Skill library reviewed — any new durable pattern promoted.
- [ ] Evolution proposals generated for next cycle.
