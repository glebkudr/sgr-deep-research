Indexing API (Upload + Job Status)

Outcome
- Minimal API to receive files/paths, enqueue an indexing job, and report job status.

Tasks
1) Endpoints
   - POST /upload
     - Accept multipart files OR JSON { paths: string[], collection: string }.
     - Save raw files to `/workspace/<collection>/<job-id>/raw`.
     - Enqueue job in Redis with initial status PENDING.
     - Response: { job_id }.
   - GET /jobs/{job_id}
     - Return: { status, stats, errors[] } from Redis.

2) Validation
   - Validate collection string and file extensions.
   - Enforce single-operator JWT (simple bearer) for protected routes.

3) Integration with worker
   - Define queue/list in Redis the worker listens to.
   - Ensure job payload contains collection, job_id, and path to raw files.

4) Error handling
   - Return clear messages for invalid inputs; HTTP 400/404/500 as appropriate.

Acceptance
- Upload of N sample files produces a job_id; status transitions from PENDING→RUNNING→DONE with stats.

