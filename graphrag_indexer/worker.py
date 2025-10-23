from __future__ import annotations

import logging
import signal
import sys
import time
from typing import Optional

from graphrag_service.queue import JobQueue

from .pipeline import IndexingPipeline


logger = logging.getLogger(__name__)


class Worker:
    def __init__(self) -> None:
        self.queue = JobQueue()
        self.pipeline = IndexingPipeline()
        self._stopped = False

    def stop(self) -> None:
        self._stopped = True

    def run(self) -> None:
        logger.info("GraphRAG indexer worker started.")
        while not self._stopped:
            job = self.queue.dequeue(timeout=5)
            if not job:
                time.sleep(1)
                continue
            logger.info("Dequeued job %s (%s).", job.job_id, job.collection)
            try:
                self.pipeline.run(job)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Job %s failed with unexpected error: %s", job.job_id, exc)

        logger.info("GraphRAG indexer worker stopped.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    worker = Worker()

    def handle_signal(signum: int, frame: Optional[object]) -> None:  # noqa: ARG001
        logger.info("Received signal %s. Shutting down worker.", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        worker.run()
    except KeyboardInterrupt:
        worker.stop()
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Worker crashed: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
