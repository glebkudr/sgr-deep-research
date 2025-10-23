MVP Backlog — GraphRAG for 1C (Indexer + Simple Retrieval)

Scope
- Build a minimal service to index 1C code/metadata dumps and answer questions using a hybrid vector+graph retrieval approach.
- Base the graph side on `neo4j-graphrag-python` and the ontology/configs from `docs/indexer.md` and `docs/vision.md`.
- Provide API endpoints for: indexing (upload + job status) and Q&A retrieval. GUI is out-of-scope for the very first MVP.

Structure
- 01_infra_setup.md — environment, compose, .env, base images.
- 02_neo4j_constraints.md — constraints and indices migration.
- 03_indexer_pipeline.md — loaders, extraction, embeddings, graph writing, FAISS build.
- 04_api_indexing.md — upload and job status endpoints.
- 05_vector_store.md — FAISS index, persistence, lookup.
- 06_qa_retrieval.md — vector→seed→graph expansion→LLM (strict) + SSE.
- 07_security_logging_testing.md — security, logging, tests, acceptance.
- 08_frontend_setup.md — Next.js app setup, API client, SSE utility, components.
- 09_gui_upload_index.md — Upload/Index page with progress polling.
- 10_gui_qa_chat.md — Q&A chat page with streaming, citations, graph paths.

Definition of Done (MVP)
- Indexing completes with DONE status for a sample collection; progress and final stats are persisted.
- Neo4j contains key domain nodes/edges per ontology; idempotent writes verified.
- FAISS index is built and queryable for the same collection.
- Q&A endpoint returns concise Russian answers strictly from provided context, or a clear refusal if insufficient.
- No secrets in git; operational docs are sufficient to run locally via Docker Compose.

References
- See `docs/vision.md`, `docs/indexer.md`, `docs/user_flow.md`.

