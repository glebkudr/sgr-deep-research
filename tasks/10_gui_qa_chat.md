GUI — Q&A Chat Page

Outcome
- Operator asks a question against a collection and receives a concise streamed answer with citations and graph paths.

Models (TS)
```ts
type Citation = { node_id: number; label: string; title: string; snippet: string; path?: string };
type GraphPath = { nodes: {id:number; label:string; title?:string}[]; edges:{type:string; from:number; to:number}[] };
```

Tasks
1) UI layout
   - Inputs: `question` (textarea), `collection` (select), advanced: `top_k`, `max_hops`.
   - Chat transcript with message bubbles; toolbar with send/stop.

2) Call API
   - POST `/qa` with body `{ question, collection, top_k, max_hops }`.
   - Consume SSE stream (if enabled) or standard JSON response fallback.

3) Render answer
   - Streamed text in RU; first line concise, then short explanation.

4) Citations block
   - List with title, snippet (3–5 lines), and path; copy path action.

5) Graph paths
   - Compact table: from → (edge) → to; limit to top 1–3 informative paths.

6) Errors and edge cases
   - Show clear message on 400/404/500; support refusal text "Недостаточно данных в индексе.".

Acceptance
- Typical queries render answer ≤4s p95 with ≥1–2 valid citations.
- Citations are clickable and reveal snippets/paths.


