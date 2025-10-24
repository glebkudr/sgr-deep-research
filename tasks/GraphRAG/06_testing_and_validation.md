## Testing and Validation

### Unit Tests
- Prompt loader selects `graphrag_system_prompt.txt` and expands `{available_tools}`.
- Refusal string exact match present and used on insufficient context.
- VectorSearchChunksTool: input validation, successful query with stubbed FAISS.
- FilesRankFromChunksTool: aggregation correctness for max/mean/softmax_attn; deterministic ordering.
- FilesNeighborhoodViaChunksTool: whitelist enforcement, limit caps, invalid inputs.
- FilesPruneFrontierTool: visited filter, min_score threshold, dedup, truncation and dropped reasons.
- Supporting tools: structure of results, input validation, no web calls.

### Integration Tests
- End-to-end scenario: retrieve→promote→expand→prune→finalize with FAISS/Neo4j stubs.
- Assert: no web tools called; stop conditions respected; explainability artifacts (supporting chunks/files/edges) present.

### Behavioral Tests
- When context is insufficient: exact refusal string.
- Answers contain concise Russian text with supporting facts when available.

### Test Hints
- Use dependency injection for FAISS/Neo4j clients; provide fakes with deterministic outputs.
- Seed random-like sequences deterministically.
- Validate structured logs contain iteration counts, limits, and stop reason.


