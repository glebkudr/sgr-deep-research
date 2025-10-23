Indexer Pipeline (Loaders → Extract 1C → Chunk → Embeddings → Graph → FAISS)

Outcome
- Worker that processes a job with files from `/workspace/<collection>/<job-id>/raw` and produces graph nodes/edges in Neo4j and a FAISS vector index in `/indexes/<collection>/faiss` with mapping `chunk_id ↔ node_id, path`.

Tasks
1) Job model and state in Redis
   - Status: PENDING | RUNNING | DONE | ERROR; stats: processed_files, nodes, edges, vector_chunks, duration_sec, errors[].
   - Keys per job-id; JSON payload.

2) Loaders
   - Recursive scan of `raw/`; whitelist extensions: .bsl, .xml, .html, .txt.
   - Normalize encoding and newlines; compute relative path.

3) 1C feature extraction (heuristic)
   - From BSL: routines (name/signature/export/exec_side), CALLS, READS_FROM/WRITES_TO, REFERENCES, owner_qn.
   - From XML/HTML: forms, controls, bindings, roles, commands if detectable.
   - Emit entities/relations conforming to ontology v2 (docs/indexer.md schema).

4) Chunking
   - Semantic/structural with target ~800 tokens, overlap ~120; fallback to size-based.

5) Embeddings
   - OpenAI text-embedding-3-large; batching, retries, rate limits; BYOK via env.

6) Graph writer (Neo4j)
   - Idempotent upserts (MERGE) for nodes/edges using entity_resolution keys.
   - Maintain counters for nodes/edges written.

7) Vector index (FAISS)
   - Build and persist per collection; store mapping `chunk_id → node_id, path`.

8) Progress reporting
   - Update Redis per phase/file; include errors with file path and message.

9) Idempotency and restart safety
   - Re-running a job does not duplicate nodes/edges; FAISS rebuild overwrites same collection.

Acceptance
- End-to-end pipeline succeeds on a small sample within reasonable time; job status shows DONE and stats match expectations.

