Frontend Setup (Next.js)

Outcome
- Minimal Next.js app ready for Upload/Index and Q&A pages, wired to API via env.

Tasks
1) App bootstrap
   - Create `/frontend` Next.js (TypeScript). Minimal styling (Tailwind optional).
   - Pages: `/upload`, `/qa` placeholders.

2) Environment
   - Use `NEXT_PUBLIC_API_URL` to point to API base URL.
   - (Dev) Optional `NEXT_PUBLIC_JWT` for single-operator token in requests.

3) API client
   - Small wrapper around `fetch` with RORO pattern: `{ path, method, headers?, body? } -> { ok, status, data, error }`.
   - Attach Bearer from cookie or `NEXT_PUBLIC_JWT` when present.

4) SSE utility
   - Helper to consume Server-Sent Events for streaming answers.

5) Shared UI components
   - Button, Input, Select, Spinner, ProgressBar, Toast.

6) Docker integration
   - Dockerfile for `/frontend` and compose service `front` with port mapping (e.g., 3000).

7) CORS (API side)
   - Ensure API allows front origin in dev.

Acceptance
- `npm run dev` starts the app; `/upload` and `/qa` render placeholders.
- API base URL is read from `NEXT_PUBLIC_API_URL`.


