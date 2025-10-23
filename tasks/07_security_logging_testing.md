Security, Logging, Testing, and Acceptance

Outcome
- Basic but solid operational posture for single-operator MVP with clear acceptance tests.

Tasks
1) Security
   - JWT-protected endpoints (/upload, /jobs/*, /qa).
   - Secrets only in .env; validate presence at startup.
   - Local-only exposure by default; document reverse proxy if needed.

2) Logging
   - Structured logs per phase in indexer; aggregate counters: files, chunks, nodes, edges, faiss_vectors, duration.
   - API access logs and error logs with correlation by job_id.

3) Testing
   - Unit tests: BSL parsers/heuristics, graph writer upsert idempotency, FAISS build/query.
   - Integration: end-to-end small corpus indexing; Q&A returns expected citations.

4) Acceptance (from docs/user_flow.md)
   - Indexing DONE within target on sample (≤ 60 min on 5GB is baseline goal).
   - Neo4j contains key nodes/edges; FAISS built; mapping saved.
   - Q&A endpoint answers concisely in RU; strict refusal when lacking context.

