# Graph Viewer (Neo4j 3D)

Self-hosted local Neo4j graph viewer with:
- Express REST API
- 3D visualization via 3d-force-graph
- Structured JSON logging

Endpoints:
- GET /health -> {"status":"ok"}
- GET /api/graph?collection=NAME&limit=2000&rels=CALLS,HAS_ROUTINE

Query rules:
- collection (required)
- limit: integer [1..10000], default 2000
- rels: optional CSV of relationship types; if omitted, all relationship types for the collection are included

Environment variables (required unless noted):
- NEO4J_URI (bolt://host:port or neo4j://host:port)
- NEO4J_USER_RO (read-only user)
- NEO4J_PASS_RO
- NEO4J_DATABASE (optional; defaults to server's default database)
- PORT (optional; default 8081)

Security:
- The server binds to 127.0.0.1:8081 by default (local only).
- Uses read-only Neo4j credentials.

Run locally (Node 20+):
1) Install deps
   npm ci
2) Build
   npm run build
3) Set env and start
   export NEO4J_URI=bolt://localhost:7687
   export NEO4J_USER_RO=neo4j_ro
   export NEO4J_PASS_RO=secret
   npm start

Docker:
- Build
  docker build -t graph-viewer:local .
- Run (note: binds to 127.0.0.1 inside container; use host networking for local-only access)
  docker run --rm --network=host \
    -e NEO4J_URI=bolt://localhost:7687 \
    -e NEO4J_USER_RO=neo4j_ro \
    -e NEO4J_PASS_RO=secret \
    -e PORT=8081 \
    graph-viewer:local

Open UI:
http://localhost:8081/?collection=YOUR_COLLECTION

Logging:
- Structured JSON to stdout.
- Request logs include method, path, status, duration_ms.
- Errors are logged at level=error and return HTTP 500 with JSON body.