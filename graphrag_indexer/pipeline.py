from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

from graphrag_service.config import get_settings
from graphrag_service.embeddings import OpenAIEmbeddingClient
from graphrag_service.jobs import JobError, JobState, JobStatus, JobStore, JobStats
from graphrag_service.queue import IndexJob
from graphrag_service.vector_store import FaissVectorStore

from .chunker import chunk_text_units
from .extractors import extract_document
from .graph_writer import Neo4jGraphWriter
from .loader import load_documents
from .models import Chunk, GraphEdge, GraphNode, NodeKey, TextUnit
from .schema_validator import SchemaValidationError, SchemaValidator


logger = logging.getLogger(__name__)


class IndexingPipeline:
    def __init__(self, job_store: JobStore | None = None) -> None:
        self.job_store = job_store or JobStore()
        self.settings = get_settings()
        self.schema_validator = SchemaValidator.from_config()

    def run(self, job: IndexJob) -> None:
        logger.info("Starting indexing job %s for collection %s", job.job_id, job.collection)
        job_state = self.job_store.get(job.job_id) or JobState(job_id=job.job_id, collection=job.collection)
        job_state.status = JobStatus.RUNNING
        job_state.started_at = datetime.utcnow()
        job_state.errors = []
        job_state.stats = JobStats()
        self.job_store.save(job_state)

        try:
            documents = load_documents(Path(job.raw_path))
            logger.info("Loaded %d documents from %s", len(documents), job.raw_path)

            nodes_by_key: Dict[NodeKey, GraphNode] = {}
            edges_keyed: Dict[Tuple[NodeKey, str, NodeKey], GraphEdge] = {}
            text_units: List[TextUnit] = []

            for doc in documents:
                try:
                    extraction = extract_document(doc)
                    self.schema_validator.validate(extraction, source=doc.rel_path)
                    self._merge_nodes(nodes_by_key, extraction.nodes)
                    self._merge_edges(edges_keyed, extraction.edges)
                    text_units.extend(extraction.text_units)
                except SchemaValidationError as exc:
                    logger.error("Schema validation failed for %s: %s", doc.rel_path, exc)
                    raise
                except Exception as exc:  # pylint: disable=broad-except
                    logger.exception("Failed to process %s: %s", doc.rel_path, exc)
                    job_state.errors.append(JobError(message=str(exc), path=doc.rel_path))
                finally:
                    job_state.stats.processed_files += 1
                    self.job_store.save(job_state)

            if job_state.errors:
                logger.warning("Job %s completed with %d errors.", job.job_id, len(job_state.errors))

            chunks = chunk_text_units(text_units)
            if not chunks:
                logger.warning("No chunks generated for job %s.", job.job_id)
            else:
                logger.info("Generated %d chunks for job %s", len(chunks), job.job_id)
            job_state.stats.vector_chunks = len(chunks)
            self.job_store.save(job_state)

            embeddings = self._compute_embeddings(chunks)
            if embeddings.size:
                logger.info("Computed embeddings for %d chunks", embeddings.shape[0])

            node_ids = self._write_graph(job_state, nodes_by_key, list(edges_keyed.values()))
            logger.info("Upserted %d nodes and %d edges into Neo4j", len(nodes_by_key), len(edges_keyed))
            job_state.stats.nodes = len(nodes_by_key)
            job_state.stats.edges = len(edges_keyed)
            self.job_store.save(job_state)
            self._build_vector_index(job.collection, chunks, embeddings, node_ids)
            logger.info("Vector index updated for collection %s", job.collection)

            job_state.status = JobStatus.DONE
            job_state.finished_at = datetime.utcnow()
            job_state.stats.duration_sec = (
                (job_state.finished_at - job_state.started_at).total_seconds() if job_state.started_at else 0.0
            )
            self.job_store.save(job_state)
            logger.info("Job %s finished successfully.", job.job_id)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Job %s failed: %s", job.job_id, exc)
            job_state.status = JobStatus.ERROR
            job_state.finished_at = datetime.utcnow()
            job_state.errors.append(JobError(message=str(exc)))
            job_state.stats.duration_sec = (
                (job_state.finished_at - job_state.started_at).total_seconds() if job_state.started_at else 0.0
            )
            self.job_store.save(job_state)

    def _merge_nodes(self, nodes_by_key: Dict[NodeKey, GraphNode], nodes: List[GraphNode]) -> None:
        for node in nodes:
            key = node.node_key()
            if key in nodes_by_key:
                existing = nodes_by_key[key]
                existing.properties.update({k: v for k, v in node.properties.items() if v is not None})
            else:
                nodes_by_key[key] = node

    def _merge_edges(self, edges_keyed: Dict[Tuple[NodeKey, str, NodeKey], GraphEdge], edges: List[GraphEdge]) -> None:
        for edge in edges:
            key = (edge.start, edge.type, edge.end)
            if key not in edges_keyed:
                edges_keyed[key] = edge

    def _compute_embeddings(self, chunks: List[Chunk]) -> np.ndarray:
        if not chunks:
            return np.zeros((0, 0), dtype=np.float32)
        client = OpenAIEmbeddingClient()
        texts = [chunk.text for chunk in chunks]
        return client.embed_texts(texts)

    def _write_graph(
        self,
        job_state: JobState,
        nodes_by_key: Dict[NodeKey, GraphNode],
        edges: List[GraphEdge],
    ) -> Dict[NodeKey, int]:
        writer = Neo4jGraphWriter()
        try:
            node_ids = writer.upsert(nodes_by_key.values(), edges)
            return node_ids
        finally:
            writer.close()

    def _build_vector_index(
        self,
        collection: str,
        chunks: List[Chunk],
        embeddings: np.ndarray,
        node_ids: Dict[NodeKey, int],
    ) -> None:
        if embeddings.size == 0 or not chunks:
            return
        store = FaissVectorStore(collection)
        store.build(embeddings, [chunk.chunk_id for chunk in chunks])
        metadata = []
        for chunk in chunks:
            node_id = node_ids.get(chunk.node_key)
            metadata.append(
                {
                    "chunk_id": chunk.chunk_id,
                    "node_id": node_id,
                    "path": chunk.path,
                    "text": chunk.text,
                    "text_snippet": chunk.text[:300],
                }
            )
        store.set_metadata(metadata)
        store.save()
