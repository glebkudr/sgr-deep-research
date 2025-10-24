## Phase 2 — Graph Expansion and Frontier Pruning

### Scope
- Implement `FilesNeighborhoodViaChunksTool` (Neo4j-driven expansion from seed files) with whitelisted edge types.
- Implement `FilesPruneFrontierTool` for anti-explosion, deduplication, thresholding.

### Interfaces (RORO)
- FilesNeighborhoodViaChunksTool(input):
  - `file_ids: [str]`
  - `edge_types: [str]` in whitelist {`REFERS_TO`, `CALLS`, `IMPORTS`, `INCLUDES`}
  - `max_neighbors_per_file: int`
  - `max_total_neighbors: int`
  - `min_edge_score: float` (optional; validated if provided)
  - Returns: `{ neighbors: [{ file_id, path, via_edges: [{ type, from, to, weight, cypher }]}] }`
- FilesPruneFrontierTool(input):
  - `candidates: [{ file_id, score, path, via_edges: [...] }]`
  - `visited_file_ids: set[str]`
  - `min_score: float`
  - `max_batch: int`
  - Returns: `{ frontier: [{ file_id, score, path, via_edges }], dropped: { reason: count } }`

### Behavior
- FilesNeighborhoodViaChunksTool:
  - Executes parameterized Cypher with strict whitelist for `edge_types`.
  - Applies caps: `max_neighbors_per_file`, `max_total_neighbors`.
  - Returns neighbor files with supporting edges per neighbor.
  - Validates inputs; fail fast on empty `file_ids`, invalid edge types, or non-positive limits.
  - Structured logging: input sizes, edge types, limits; logs query summary (not raw data) on success, full context on failure.
- FilesPruneFrontierTool:
  - Filters out `visited_file_ids`.
  - Drops candidates below `min_score`.
  - Deduplicates by `file_id` keeping highest score; truncates to `max_batch`.
  - Returns counts by reason: `visited`, `low_score`, `duplicate`, `truncated`.

### Cypher (sketch)
```text
MATCH (f:File) WHERE f.id IN $file_ids
MATCH (f)-[r]->(n:File)
WHERE type(r) IN $edge_types
WITH f, n, r
ORDER BY r.weight DESC
WITH f, n, collect(r)[0..$max_neighbors_per_file] AS rs
RETURN n.id AS file_id, n.path AS path,
       [x IN rs | {type:type(x), from:startNode(x).id, to:endNode(x).id, weight:coalesce(x.weight,1.0)}] AS via_edges
LIMIT $max_total_neighbors
```

### Acceptance Criteria (DoD)
- Neighborhood tool returns neighbors only across whitelisted edge types within configured limits.
- Prune tool returns bounded, deduped frontier with structured dropped reasons.
- Input validation errors are raised with context; no hidden retries.
- Unit tests cover: invalid edge types, limit enforcement, dedup and thresholds.

### Observability & Policy
- Log sizes and limits; log dropped reason counters.
- Fail fast on missing/invalid inputs; no chained defaults for required config.


