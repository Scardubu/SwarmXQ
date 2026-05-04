# SwarmX V4 Production Notes

SwarmX V4 is the mission-aware evolution of the previous bundles. It introduces a durable control plane that treats every meaningful action as a stored object:

- **missions** describe intent, policy, plan, and stage map
- **jobs** carry execution work through the queue
- **events** record lifecycle changes and worker activity
- **memories** capture durable lessons
- **metrics** and the **memory graph** expose the runtime shape

## What changed in V4

1. Mission records are created before execution and updated after completion.
2. Policy decisions gate autonomy and human review requirements.
3. The worker can handle mission-oriented jobs in addition to runs and evolution.
4. Search and graph views now include missions and events.
5. The dashboard can consume the richer runtime state without changing the deployment model.

## Recommended runtime flow

- initialize a repo with `swarm init`
- create a mission with `swarm mission <repo> <target> --queue`
- run the worker with `swarm worker <repo>` or rely on the dashboard server
- inspect with `swarm status`, `swarm graph`, and `swarm search`
- evolve with `swarm evolve` only after reviewing the stored policy and metrics

## Storage model

The runtime uses the existing SQLite control-store for local-first durability. This keeps the bundle easy to execute while still providing persistence, replay, and an audit trail. For larger deployments, this storage layer is the seam to replace with an external service.
