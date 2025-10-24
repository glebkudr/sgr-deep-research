## NFRs, Observability, and Security

### Reliability
- Fail fast on invalid input or missing required config; raise with context.
- No hidden retries; retries only if explicitly configured, idempotent, bounded, and logged.

### Performance
- Enforce limits: `max_iters`, `max_files_total`, `max_neighbors_per_iter`, `min_score`.
- Early ranking at file level; prune frontier aggressively to avoid graph explosion.

### Maintainability
- Separate prompt, agent profile, and tools; avoid over-abstraction.
- RORO interfaces; explicit parameters; no global variables.

### Security
- No external web calls in GraphRAG profile.
- Validate and whitelist edge types for Neo4j queries.
- Parameterized Cypher; avoid dynamic string concatenation.

### Observability
- Structured logging fields: `profile`, `tools`, `limits`, `iteration`, `selected_files_count`, `frontier_size`, `stop_reason`.
- Log errors with contextual parameters; do not downgrade severity.
- MemoryStoreStateTool keeps an audit trail of decisions and inputs/outputs per iteration.


