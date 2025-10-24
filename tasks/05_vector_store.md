Vector Store (FAISS) — Build and Query

Outcome
- Per-collection FAISS index stored under `/indexes/<collection>/faiss` with mapping table for chunk metadata.

Tasks
1) Storage layout
   - Directory per collection; atomic writes (temp file then move) for rebuilds.

2) Build API
   - Component to bulk add embedding vectors with IDs and persist the index.
   - Save mapping of `chunk_id → { node_id, path, text_snippet }` in a sidecar file (e.g., JSONL or sqlite).

3) Query API
   - Given query embedding, return top_k vector hits with metadata.

4) Integration
   - Indexer uses Build API after embeddings phase.
   - Retrieval uses Query API to get initial candidates (top_k_v ≈ 50).

Acceptance
- Index builds and loads quickly; top_k queries return stable results and include paths for citations.


