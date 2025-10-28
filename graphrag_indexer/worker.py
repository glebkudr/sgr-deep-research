from __future__ import annotations

import logging
import signal
import sys
import time
from pathlib import Path
from typing import Optional

from graphrag_service.config import get_settings
from graphrag_service.jobs import JobStatus
from graphrag_service.queue import JobQueue, IndexJob

from .pipeline import IndexingPipeline


logger = logging.getLogger(__name__)


class Worker:
    def __init__(self) -> None:
        self.queue = JobQueue()
        self.pipeline = IndexingPipeline()
        self._stopped = False
        self._recover_incomplete_jobs()

    def stop(self) -> None:
        self._stopped = True

    def run(self) -> None:
        logger.info("event=worker_started service=indexer")
        while not self._stopped:
            job = self.queue.dequeue(timeout=5)
            if not job:
                time.sleep(1)
                continue
            logger.info("event=job_dequeued job_id=%s collection=%s", job.job_id, job.collection)
            try:
                self.pipeline.run(job)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("event=job_unexpected_error job_id=%s collection=%s error=%s", job.job_id, job.collection, exc)

        logger.info("event=worker_stopped service=indexer")

    def _recover_incomplete_jobs(self) -> None:
        settings = get_settings()
        queue_job_ids = self.queue.list_job_ids()
        workspace_dir = Path(settings.workspace_dir)
        for state in self.pipeline.job_store.iter_states():
            if state.status not in {JobStatus.PENDING, JobStatus.RUNNING}:
                continue
            if state.job_id in queue_job_ids:
                continue
            raw_path = workspace_dir / state.collection / state.job_id / "raw"
            if not raw_path.is_dir():
                logger.error(
                    "event=job_recover_missing_raw job_id=%s collection=%s path=%s status=%s",
                    state.job_id,
                    state.collection,
                    raw_path,
                    state.status.value,
                )
                continue
            logger.warning(
                "event=job_recover_requeue job_id=%s collection=%s status=%s",
                state.job_id,
                state.collection,
                state.status.value,
            )
            state.status = JobStatus.PENDING
            state.started_at = None
            state.finished_at = None
            self.pipeline.job_store.save(state)
            self.queue.enqueue(IndexJob(job_id=state.job_id, collection=state.collection, raw_path=str(raw_path)))
            queue_job_ids.add(state.job_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    worker = Worker()

    def handle_signal(signum: int, frame: Optional[object]) -> None:  # noqa: ARG001
        logger.info("event=signal_received service=indexer signal=%s", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        worker.run()
    except KeyboardInterrupt:
        worker.stop()
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("event=worker_crashed service=indexer error=%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
