from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from graphrag_service.jobs import JobError, JobState


class UploadPathsRequest(BaseModel):
    collection: str = Field(min_length=1, max_length=100)
    paths: List[str]


class UploadResponse(BaseModel):
    job_id: str


class JobStatsSchema(BaseModel):
    phase: str = Field(default="")
    total_files: int = Field(default=0)
    processed_files: int
    nodes: int
    edges: int
    vector_chunks: int
    embedded_chunks: int = Field(default=0)
    graph_nodes_total: int = Field(default=0)
    graph_nodes_written: int = Field(default=0)
    graph_edges_total: int = Field(default=0)
    graph_edges_written: int = Field(default=0)
    duration_sec: float


class JobErrorSchema(BaseModel):
    message: str
    path: Optional[str] = None


class JobStateSchema(BaseModel):
    job_id: str
    collection: str
    status: str
    stats: JobStatsSchema
    errors: List[JobErrorSchema]
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]

    @staticmethod
    def from_job_state(state: JobState) -> "JobStateSchema":
        return JobStateSchema(
            job_id=state.job_id,
            collection=state.collection,
            status=state.status.value,
            stats=JobStatsSchema(
                phase=state.stats.phase,
                total_files=state.stats.total_files,
                processed_files=state.stats.processed_files,
                nodes=state.stats.nodes,
                edges=state.stats.edges,
                vector_chunks=state.stats.vector_chunks,
                embedded_chunks=state.stats.embedded_chunks,
                graph_nodes_total=state.stats.graph_nodes_total,
                graph_nodes_written=state.stats.graph_nodes_written,
                graph_edges_total=state.stats.graph_edges_total,
                graph_edges_written=state.stats.graph_edges_written,
                duration_sec=state.stats.duration_sec,
            ),
            errors=[JobErrorSchema(message=err.message, path=err.path) for err in state.errors],
            created_at=state.created_at,
            updated_at=state.updated_at,
            started_at=state.started_at,
            finished_at=state.finished_at,
        )


class CitationSchema(BaseModel):
    node_id: Optional[int]
    label: Optional[str]
    title: str
    snippet: str
    path: Optional[str] = None
    score: Optional[float] = None


class GraphNodeSchema(BaseModel):
    id: int
    label: str
    title: Optional[str] = None


class GraphEdgeSchema(BaseModel):
    type: str
    source: int
    target: int


class GraphPathSchema(BaseModel):
    nodes: List[GraphNodeSchema]
    edges: List[GraphEdgeSchema]


class QARequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    collection: str = Field(min_length=1, max_length=100)
    top_k: int = Field(default=12, ge=1, le=50)
    max_hops: int = Field(default=2, ge=0, le=4)


class QAResponse(BaseModel):
    answer: str
    citations: List[CitationSchema]
    graph_paths: List[GraphPathSchema]
    cypher_used: List[str]
    confidence: float
