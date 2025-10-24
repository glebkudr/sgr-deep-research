GUI — Upload/Index Page

Outcome
- Operator can choose collection and files, start indexing, and monitor progress with status and stats.

Models (TS)
```ts
type Job = {
  id: string;
  status: 'PENDING'|'RUNNING'|'DONE'|'ERROR';
  stats?: { processed_files: number; nodes: number; edges: number; vector_chunks: number; };
  errors?: string[];
}
```

Tasks
1) UI layout
   - Inputs: `collection` (text), file dropzone (drag&drop or picker), button "Index".
   - Show selected files list and total size.

2) Validation
   - Allowed extensions: .bsl, .xml, .html, .txt.
   - Disable button until collection and at least one file are provided.

3) Start indexing
   - POST `/upload` (multipart or { paths } mode later). Receive `{ job_id }`.
   - Persist recent jobs in localStorage for quick access.

4) Progress polling
   - Poll `GET /jobs/{job_id}` every 1–2s. Update card with status and stats.
   - ProgressBar from `processed_files`/estimated total (fallback: indeterminate).

5) Errors and actions
   - Show `errors[]` as expandable list with file names when available.
   - Quick actions: "Repeat" (re-upload), "Open in Q&A".

6) Recent jobs panel
   - List last N jobs with status badges; click to resume polling view.

Acceptance
- Upload triggers job creation; UI shows PENDING→RUNNING→DONE transitions.
- Stats counters update; errors render clearly.


