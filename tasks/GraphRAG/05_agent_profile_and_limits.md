## Phase 3 — Agent Profile and Limits

### Scope
- Provide a GraphRAG agent profile that wires the new prompt and GraphRAG-only toolkit.
- Expose iteration and expansion budgets through config.

### Agent Profile
- Uses `graphrag_system_prompt.txt` via prompt loader.
- Toolkit includes only GraphRAG tools: VectorSearchChunks, FilesRankFromChunks, FilesNeighborhoodViaChunks, FilesPruneFrontier, FilesGetFull, GraphTextMatchFiles, GraphEffectsOfFile, ParentsOfChunks, MemoryStoreState, ReasoningTool, FinalAnswerTool.
- Explicitly excludes `WebSearchTool` and `ExtractPageContentTool`.

### Limits (config-driven)
- `max_iters`: maximum reasoning iterations.
- `max_files_total`: bound on total unique files under consideration.
- `max_neighbors_per_iter`: cap for graph expansion per iteration.
- `min_score`: minimum score for frontier inclusion.
- No chained defaults for required limits; raise if missing. UI may provide display-only defaults.

### Behavior
- Each iteration:
  1) Vector search → rank files.
  2) Expand neighbors (whitelist edges) within limits.
  3) Prune frontier by `visited`, `min_score`, `max_batch`.
  4) Stop if frontier empty, or top-N stable, or `max_iters` reached, or `max_files_total` exceeded.
- On insufficient evidence, agent must return the exact refusal string.

### Acceptance Criteria (DoD)
- GraphRAG agent can be instantiated via factory with profile name and loads the correct prompt.
- Toolkit contains no web tools; test asserts absence.
- Limits enforced in control loop; unit test simulates iterations with stubs and confirms stop conditions.

### Observability & Policy
- Structured logs of profile selection, tool list, limits, per-iteration counts and stop reason.
- No hidden retries; fail fast on missing config.


