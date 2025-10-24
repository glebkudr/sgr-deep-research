## Phase 1 — GraphRAG Prompt and Configuration

### Scope
- Introduce a dedicated GraphRAG system prompt that enforces file-centric, graph-first retrieval and forbids web tools.
- Wire up configuration so a GraphRAG agent profile loads the new prompt and exposes only GraphRAG tools.

### Outcomes
- A new prompt file exists: `sgr_deep_research/core/prompts/graphrag_system_prompt.txt`.
- The prompt includes `{available_tools}` placeholder and strict fail-fast refusal: "Извините, я не нашёл подходящего ответа." (exact string).
- GraphRAG agent profile loads the new prompt and excludes web tools from its toolkit.

### Tasks
- Create `graphrag_system_prompt.txt` with:
  - Role: GraphRAG file-centric retriever for 1C codebases (answer in Russian only).
  - Hard constraints: use only listed tools, no web search; call ReasoningTool before/after actions; ground answers strictly in retrieved context; refusal string above.
  - Strategy: vector→chunks → promote→files → expand→neighbors → rerank/prune; iterate with budgets/stop rules.
  - Explainability: keep supporting chunks/files/edges; store iteration state via memory tool.
  - Finalization: use FinalAnswerTool only when enough_data is true.
  - Include `{available_tools}` placeholder.
- Add a GraphRAG profile in config that points system prompt to `graphrag_system_prompt.txt`.
- Ensure the agent factory builds a GraphRAG toolkit (GraphRAG tools only; no `WebSearchTool`, no `ExtractPageContentTool`).

### Configuration
- Config key (example):
  - `prompts.system_prompt_file: graphrag_system_prompt.txt`
  - Optional: `prompts.prompts_dir` if custom directory is used.
- Agent factory must map GraphRAG profile → GraphRAG prompt and toolkit.

### Acceptance Criteria (DoD)
- Prompt loader resolves and returns the new prompt with `{available_tools}` expanded to the GraphRAG tools list.
- GraphRAG agent profile initializes without any web tools in the toolkit.
- A unit test asserts the refusal string is present and exact.
- A config/profile test asserts the GraphRAG profile loads `graphrag_system_prompt.txt`.

### Observability & Policy
- Enforce fail-fast: on insufficient context, return the exact refusal string.
- Structured logging on initialization: selected profile, prompt path, tool list (no web tools).
- No hidden retries; no chained defaults for required config. If critical config is missing, raise immediately and log context.

### Risks & Mitigations
- Risk: Accidental inclusion of web tools. Mitigation: explicit denylist check in GraphRAG profile construction and test coverage.
- Risk: Prompt not loaded due to path mismatch. Mitigation: config test and clear error upon missing file.

### Deliverables
- `sgr_deep_research/core/prompts/graphrag_system_prompt.txt` (content per plan).
- Config/profile wiring to use the new prompt.
- Tests for prompt loading, tool availability, refusal string.


