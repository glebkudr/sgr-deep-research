Infrastructure Setup (Neo4j, Redis, .env, Folders)

Outcome
- Local dev environment with Docker Compose for Neo4j and Redis.
- Project folders for workspace and indexes exist and are writable.
- .env and config files prepared (not committed with secrets).

Tasks
1) Create folders
   - Create `/workspace` and `/indexes` at repo root (gitignored). Ensure write permissions.
   - Windows: create directories under project root.

2) Env files
   - Copy `.env.example` to `.env` for all services.
   - Variables: OPENAI_API_KEY, NEO4J_PASSWORD, JWT_SECRET, EMBEDDING_MODEL.
   - Do not commit secrets.

3) Docker Compose services
   - Add/verify `neo4j` service (bolt 7687, http 7474), volumes for data/logs, envs for heap/pagecache.
   - Add/verify `redis` service with default config.
   - Prepare service definitions for future `graphrag-api` and `graphrag-indexer` (can be placeholders at this step).

4) Neo4j memory settings (dev-friendly)
   - HEAP=8G, PAGECACHE=8G for medium corpora (see docs/vision.md resources).

5) Makefile helpers (optional)
   - `make up`, `make down`, `make logs`, `make seed-neo4j-constraints`.

Acceptance
- `docker compose up -d neo4j redis` succeeds; Neo4j is reachable at bolt://localhost:7687.
- Folders `/workspace` and `/indexes` exist.
- `.env` present locally; not tracked in git.

