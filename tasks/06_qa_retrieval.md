Q&A Retrieval (Vector → Seed → Graph → LLM Strict)

Outcome
- API that answers domain questions strictly from indexed context; returns answer, citations, graph paths, cypher_used, confidence.

Tasks
1) Endpoint
   - POST /qa
     - Input: { question, collection, top_k=12, max_hops=2 }.
     - Output: { answer, citations[], graph_paths[], cypher_used[], confidence }.

2) Vector search
   - Use FAISS to fetch top_k_v ≈ 50 candidates.

3) Seed extraction
   - From candidate chunks, resolve related domain nodes (Routine/Object/Register/...).
   - Build seed_ids set.

4) Graph expansion (Neo4j)
   - K-hop expansion with strong relations: CALLS, USES_MODULE, REFERENCES, WRITES_TO, READS_FROM, HAS_*.
   - Collect paths and record cypher_used.

5) Context pack
   - Best chunks (text + path), support nodes, paths, cypher list.

6) LLM (strict grounding)
   - Prompt in EN with rule: answer in RU, only from context; otherwise "Недостаточно данных в индексе.".

7) Streaming (optional)
   - SSE for incremental answer.

Acceptance
- Typical questions like "кто вызывает Y" or "где пишется регистр X" respond ≤ 4s p95 with ≥ 1–2 valid citations.

