## Phase 2 — Supporting Tools

### Scope
- Implement supporting tools for explainability, metadata enrichment, and lightweight text matching.

### Tools (RORO)
- FilesGetFullTool(input):
  - `file_ids: [str]`
  - `include_content: bool` (explicit; default must be provided by caller)
  - Returns: `{ files: [{ file_id, path, content?, size, lang, metadata }] }`
- GraphTextMatchFilesTool(input):
  - `query_text: str`
  - `fields: [str]` in {`name`, `path`, `comment`}
  - `top_n: int`
  - Returns: `{ files: [{ file_id, path, score, matched_fields: [str] }] }`
- GraphEffectsOfFileTool(input):
  - `file_id: str`
  - `edge_types: [str]` (whitelisted)
  - Returns: `{ effects: [{ type, to_file_id, to_path, weight }] }`
- ParentsOfChunksTool(input):
  - `chunk_ids: [str]`
  - Returns: `{ mapping: [{ chunk_id, parent_file_id, path }] }`
- MemoryStoreStateTool(input):
  - `iteration: int`
  - `state: dict` (tool decisions, selected files, edges, scores)
  - Returns: `{ stored: bool, key: str }`

### Behavior
- Validate inputs and fail fast on empty lists or missing required fields.
- No hidden retries; no chained defaults for required config.
- Log structured summaries: counts, fields used, sizes.
- Use existing services (Neo4j/file store) for content/metadata retrieval; do not reach web.

### Acceptance Criteria (DoD)
- Each tool returns the documented structure; fields are present and typed.
- ParentsOfChunksTool fills missing metadata deterministically.
- MemoryStoreStateTool is append-only and provides a retrieval key for audit.
- Unit tests cover input validation and structure of results.


