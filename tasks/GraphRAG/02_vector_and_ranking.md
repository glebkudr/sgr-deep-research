## Phase 2 — Vector Search and File Ranking

### Scope
- Implement `VectorSearchChunksTool` for initial chunk retrieval from FAISS.
- Implement `FilesRankFromChunksTool` for passage→document aggregation and reranking.

### Interfaces (RORO)
- VectorSearchChunksTool(input):
  - `query_text: str`
  - `collection: str`
  - `top_k: int` (default via config; no hidden defaults in business logic)
  - `filters: dict` (optional; validated)
  - Returns: `{ chunks: [{ chunk_id, text, score, parent_file_id, path, node_id }], used_top_k }`
- FilesRankFromChunksTool(input):
  - `chunks: list`
  - `method: str` in {`max`, `mean`, `softmax_attn`}
  - `temperature: float` (only for softmax_attn; validated range)
  - `top_n: int`
  - Returns: `{ files: [{ file_id, path, score, supporting_chunks: [chunk_id...] }], method }`

### Behavior
- VectorSearchChunksTool:
  - Uses `graphrag_service.vector_store.FaissVectorStore` to encode and query.
  - Validates inputs; fail fast on missing `collection`, `query_text`, or non-positive `top_k`.
  - Does not invent metadata; expects `parent_file_id`, `path`, `node_id` in chunk metadata, else client must call ParentsOfChunksTool.
  - Structured logging on start/failure with collection, top_k, filters (no PII).
- FilesRankFromChunksTool:
  - Groups by `parent_file_id`; aggregates scores:
    - `max`: per-file max(score)
    - `mean`: per-file mean(score)
    - `softmax_attn`: attention-weighted sum over normalized chunk scores with temperature τ
  - Returns top-N files with sorted scores and supporting chunk ids.
  - Validates `method`, `temperature` (>0), `top_n` (>0); fail fast otherwise.
  - No chained defaults for required inputs.

### Pseudocode (aggregation)
```python
def aggregate_scores(chunks, method, temperature):
    # group by file
    by_file = {}
    for ch in chunks:
        fid = ch["parent_file_id"]
        by_file.setdefault(fid, {"scores": [], "chunk_ids": [], "path": ch.get("path")}).
        by_file[fid]["scores"].append(ch["score"])
        by_file[fid]["chunk_ids"].append(ch["chunk_id"])

    results = []
    for fid, data in by_file.items():
        s = data["scores"]
        if method == "max":
            agg = max(s)
        elif method == "mean":
            agg = sum(s) / len(s)
        else:  # softmax_attn
            # softmax with temperature τ
            exps = [math.exp(v / temperature) for v in s]
            Z = sum(exps)
            weights = [e / Z for e in exps]
            agg = sum(w * v for w, v in zip(weights, s))
        results.append({
            "file_id": fid,
            "path": data["path"],
            "score": agg,
            "supporting_chunks": data["chunk_ids"],
        })
    return sorted(results, key=lambda x: x["score"], reverse=True)
```

### Acceptance Criteria (DoD)
- VectorSearchChunksTool returns chunks with `score`, `parent_file_id`, `path`, `node_id` if present in metadata.
- FilesRankFromChunksTool produces deterministic ordering and correct aggregation for max/mean/softmax-attn (unit-tested).
- Input validation errors raise with context; no try/except around async requests.
- Structured logging on failures; no hidden retries.

### Tests
- Unit tests:
  - Vector tool: invalid inputs, successful query (with stubbed FAISS).
  - Ranking tool: aggregation correctness across methods, ties ordering deterministic (e.g., secondary sort by file_id).
- Edge cases:
  - Empty chunks list → empty files list.
  - Duplicate chunk_ids within same file handled gracefully (dedup before aggregation).

### Observability & Policy
- Log input parameters (collection, top_k, method) and counts; log failure reasons with structured fields.
- Fail fast: missing required fields or invalid values → raise.


