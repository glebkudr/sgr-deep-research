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
        logger.info("event=indexing_start job_id=%s collection=%s", job.job_id, job.collection)
        job_state = self.job_store.get(job.job_id) or JobState(job_id=job.job_id, collection=job.collection)
        job_state.status = JobStatus.RUNNING
        job_state.started_at = datetime.utcnow()
        job_state.errors = []
        # Preserve expected total_files if it was set at upload time
        preserved_total = job_state.stats.total_files if job_state.stats else 0
        job_state.stats = JobStats(total_files=preserved_total)
        self.job_store.save(job_state)

        try:
            documents = load_documents(Path(job.raw_path))
            logger.info(
                "event=load_documents_ok job_id=%s collection=%s documents=%d path=%s",
                job.job_id,
                job.collection,
                len(documents),
                job.raw_path,
            )
            if job_state.stats.total_files == 0:
                job_state.stats.total_files = len(documents)
                self.job_store.save(job_state)
                logger.info("event=init_total_files job_id=%s collection=%s total_files=%d", job.job_id, job.collection, job_state.stats.total_files)
            elif job_state.stats.total_files != len(documents):
                logger.warning(
                    "event=total_files_mismatch job_id=%s collection=%s expected=%d actual=%d",
                    job.job_id,
                    job.collection,
                    job_state.stats.total_files,
                    len(documents),
                )

            nodes_by_key: Dict[NodeKey, GraphNode] = {}
            edges_keyed: Dict[Tuple[NodeKey, str, NodeKey], GraphEdge] = {}
            text_units: List[TextUnit] = []

            for doc in documents:
                try:
                    extraction = extract_document(doc)
                    self.schema_validator.validate(extraction, source=doc.rel_path)
                    self._merge_nodes(nodes_by_key, extraction.nodes)
                    self._tag_edges_with_collection(extraction.edges, job.collection)
                    self._merge_edges(edges_keyed, extraction.edges)
                    text_units.extend(extraction.text_units)
                except SchemaValidationError as exc:
                    logger.error(
                        "event=schema_validation_failed job_id=%s collection=%s path=%s error=%s",
                        job.job_id,
                        job.collection,
                        doc.rel_path,
                        exc,
                    )
                    raise
                except Exception as exc:  # pylint: disable=broad-except
                    logger.exception(
                        "event=document_processing_failed job_id=%s collection=%s path=%s error=%s",
                        job.job_id,
                        job.collection,
                        doc.rel_path,
                        exc,
                    )
                    job_state.errors.append(JobError(message=str(exc), path=doc.rel_path))
                finally:
                    job_state.stats.processed_files += 1
                    self.job_store.save(job_state)
                    if job_state.stats.processed_files % 100 == 0:
                        logger.info(
                            "event=file_progress job_id=%s collection=%s processed_files=%d total_files=%d",
                            job.job_id,
                            job.collection,
                            job_state.stats.processed_files,
                            job_state.stats.total_files,
                        )

            if job_state.errors:
                logger.warning("event=job_completed_with_errors job_id=%s collection=%s errors=%d", job.job_id, job.collection, len(job_state.errors))

            chunks = chunk_text_units(text_units)
            if not chunks:
                logger.warning("event=no_chunks job_id=%s collection=%s", job.job_id, job.collection)
            else:
                logger.info("event=chunks_generated job_id=%s collection=%s chunks=%d", job.job_id, job.collection, len(chunks))
            job_state.stats.vector_chunks = len(chunks)
            # Set phase to EMBEDDING and reset embedded counter to start deterministic progress
            job_state.stats.phase = "EMBEDDING"
            job_state.stats.embedded_chunks = 0
            self.job_store.save(job_state)
            logger.info(
                "event=phase_set job_id=%s collection=%s phase=%s vector_chunks=%d embedded_chunks=%d",
                job.job_id,
                job.collection,
                "EMBEDDING",
                job_state.stats.vector_chunks,
                job_state.stats.embedded_chunks,
            )

            embeddings = self._compute_embeddings(job_state, chunks)
            if embeddings.size:
                logger.info(
                    "event=embeddings_computed job_id=%s collection=%s embedded=%d",
                    job.job_id,
                    job.collection,
                    embeddings.shape[0],
                )

            # Prepare graph write phase with totals
            edges_list = list(edges_keyed.values())
            job_state.stats.graph_nodes_total = len(nodes_by_key)
            job_state.stats.graph_edges_total = len(edges_list)
            job_state.stats.graph_nodes_written = 0
            job_state.stats.graph_edges_written = 0
            job_state.stats.phase = "GRAPH_WRITE"
            self.job_store.save(job_state)
            logger.info(
                "event=phase_set job_id=%s collection=%s phase=%s graph_nodes_total=%d graph_edges_total=%d",
                job.job_id,
                job.collection,
                "GRAPH_WRITE",
                job_state.stats.graph_nodes_total,
                job_state.stats.graph_edges_total,
            )

            node_ids = self._write_graph(job_state, nodes_by_key, edges_list)
            # Best-effort progress: mark written equals totals upon completion
            job_state.stats.graph_nodes_written = job_state.stats.graph_nodes_total
            job_state.stats.graph_edges_written = job_state.stats.graph_edges_total
            self.job_store.save(job_state)
            logger.info(
                "event=graph_write_completed job_id=%s collection=%s graph_nodes_written=%d graph_nodes_total=%d graph_edges_written=%d graph_edges_total=%d",
                job.job_id,
                job.collection,
                job_state.stats.graph_nodes_written,
                job_state.stats.graph_nodes_total,
                job_state.stats.graph_edges_written,
                job_state.stats.graph_edges_total,
            )
            logger.info(
                "event=neo4j_upsert_summary job_id=%s collection=%s nodes=%d edges=%d",
                job.job_id,
                job.collection,
                len(nodes_by_key),
                len(edges_keyed),
            )
            job_state.stats.nodes = len(nodes_by_key)
            job_state.stats.edges = len(edges_keyed)
            self.job_store.save(job_state)
            # Vector index phase
            job_state.stats.phase = "VECTOR_INDEX"
            self.job_store.save(job_state)
            logger.info("event=phase_set job_id=%s collection=%s phase=%s", job.job_id, job.collection, "VECTOR_INDEX")
            self._build_vector_index(job.job_id, job.collection, chunks, embeddings, node_ids)
            logger.info("event=vector_index_updated job_id=%s collection=%s", job.job_id, job.collection)
            # Finalizing phase after vector index persisted
            job_state.stats.phase = "FINALIZING"
            self.job_store.save(job_state)
            logger.info("event=phase_set job_id=%s collection=%s phase=%s", job.job_id, job.collection, "FINALIZING")

            job_state.status = JobStatus.DONE
            job_state.finished_at = datetime.utcnow()
            job_state.stats.duration_sec = (
                (job_state.finished_at - job_state.started_at).total_seconds() if job_state.started_at else 0.0
            )
            self.job_store.save(job_state)
            logger.info(
                "event=job_finished status=%s job_id=%s collection=%s duration_sec=%.3f",
                "DONE",
                job.job_id,
                job.collection,
                job_state.stats.duration_sec,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("event=job_failed status=%s job_id=%s collection=%s error=%s", "ERROR", job.job_id, job.collection, exc)
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

    def _tag_edges_with_collection(self, edges: List[GraphEdge], collection: str) -> None:
        if not collection:
            raise ValueError("IndexingPipeline: 'collection' is required to tag edges; got empty value")
        for edge in edges:
            if not hasattr(edge, "properties") or edge.properties is None:
                raise ValueError("IndexingPipeline: GraphEdge.properties is missing; cannot set 'collection'")
            if not isinstance(edge.properties, dict):
                raise TypeError(f"IndexingPipeline: GraphEdge.properties must be a dict, got {type(edge.properties)}")
            edge.properties["collection"] = collection

    def _compute_embeddings(self, job_state: JobState, chunks: List[Chunk]) -> np.ndarray:
        if not chunks:
            return np.zeros((0, 0), dtype=np.float32)
        client = OpenAIEmbeddingClient()
        texts = [chunk.text for chunk in chunks]
        all_vectors: List[np.ndarray] = []
        for batch_vectors in client.embed_texts_iter(texts):
            all_vectors.append(batch_vectors)
            batch_count = batch_vectors.shape[0]
            job_state.stats.embedded_chunks += batch_count
            self.job_store.save(job_state)
            logger.info(
                "event=embedding_progress job_id=%s collection=%s embedded_chunks=%d vector_chunks=%d",
                job_state.job_id,
                job_state.collection,
                job_state.stats.embedded_chunks,
                job_state.stats.vector_chunks,
            )
        if not all_vectors:
            return np.zeros((0, 0), dtype=np.float32)
        return np.vstack(all_vectors).astype(np.float32)

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
        job_id: str,
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
                    "locator": chunk.locator,
                    "text": chunk.text,
                    "text_snippet": chunk.text[:300],
                }
            )
            logger.info(
                "event=chunk_metadata job_id=%s collection=%s chunk_id=%s node_id=%s path=%s locator=%s",
                job_id,
                collection,
                chunk.chunk_id,
                node_id,
                chunk.path,
                chunk.locator,
            )
        store.set_metadata(metadata)
        store.save()
