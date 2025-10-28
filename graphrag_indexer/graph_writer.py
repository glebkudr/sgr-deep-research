from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Callable, Dict, Iterable, Iterator, List, Sequence, Tuple

from neo4j import Driver
from neo4j.exceptions import Neo4jError

from graphrag_service.config import get_settings
from graphrag_service.neo4j_client import get_neo4j_driver

from .models import GraphEdge, GraphNode, NodeKey


logger = logging.getLogger(__name__)


def _key_hash(node_key: NodeKey) -> str:
    return f"{node_key.label}|" + "|".join(f"{k}={v}" for k, v in node_key.key)


def _chunked(items: Sequence[GraphNode] | Sequence[GraphEdge] | List, size: int) -> Iterator[List]:
    chunk: List = []
    for item in items:
        chunk.append(item)
        if len(chunk) == size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _emit_log(level: str, event: str, context: Dict[str, str], **fields: object) -> None:
    payload = {**context, **fields}
    parts = [f"event={event}"]
    for key, value in payload.items():
        if value is None:
            continue
        parts.append(f"{key}={value}")
    getattr(logger, level)(" ".join(parts))


class Neo4jGraphWriter:
    def __init__(self, driver: Driver | None = None) -> None:
        settings = get_settings()
        self.driver = driver or get_neo4j_driver()
        self.database = settings.neo4j_database
        self.node_batch_size = settings.neo4j_node_batch_size
        self.edge_batch_size = settings.neo4j_edge_batch_size
        self.max_attempts = max(1, settings.neo4j_write_max_attempts)
        self.backoff_sec = settings.neo4j_write_backoff_sec

    def close(self) -> None:
        self.driver.close()

    def upsert(
        self,
        nodes: Iterable[GraphNode],
        edges: Iterable[GraphEdge],
        *,
        context: Dict[str, str] | None = None,
        on_nodes_batch: Callable[[int], None] | None = None,
        on_edges_batch: Callable[[int], None] | None = None,
    ) -> Dict[NodeKey, str]:
        context = context or {}
        node_map: Dict[NodeKey, str] = {}
        with self.driver.session(database=self.database) as session:
            grouped_nodes: Dict[str, List[GraphNode]] = defaultdict(list)
            for node in nodes:
                grouped_nodes[node.label].append(node)

            for label, bucket in grouped_nodes.items():
                if not bucket:
                    continue
                key_fields = self._derive_node_key_fields(bucket)
                cypher = self._build_merge_node_cypher(label, key_fields)
                for batch_index, chunk in enumerate(_chunked(bucket, self.node_batch_size), start=1):
                    rows, lookup = self._build_node_rows(chunk)
                    _emit_log(
                        "info",
                        "neo4j_nodes_batch_start",
                        context,
                        label=label,
                        batch_index=batch_index,
                        batch_size=len(rows),
                    )
                    start_time = time.monotonic()

                    def run_nodes() -> List[dict]:
                        return session.execute_write(lambda tx: tx.run(cypher, nodes=rows).data())

                    result = self._execute_with_retry(
                        run_nodes,
                        context,
                        batch_kind="nodes",
                        batch_index=batch_index,
                        batch_size=len(rows),
                        label=label,
                    )
                    duration_ms = int((time.monotonic() - start_time) * 1000)
                    for record in result:
                        key_hash = record["key_hash"]
                        element_id = record["element_id"]
                        node_key = lookup.get(key_hash)
                        if not node_key:
                            raise ValueError(f"Missing node lookup for key_hash={key_hash}")
                        node_map[node_key] = element_id
                    _emit_log(
                        "info",
                        "neo4j_nodes_batch_end",
                        context,
                        label=label,
                        batch_index=batch_index,
                        batch_size=len(rows),
                        duration_ms=duration_ms,
                    )
                    if on_nodes_batch:
                        on_nodes_batch(len(rows))

            grouped_edges: Dict[Tuple[str, str, str], List[GraphEdge]] = defaultdict(list)
            for edge in edges:
                grouped_edges[(edge.start.label, edge.type, edge.end.label)].append(edge)

            for (start_label, rel_type, end_label), bucket in grouped_edges.items():
                if not bucket:
                    continue
                start_fields, end_fields = self._derive_edge_fields(bucket)
                cypher = self._build_merge_edge_cypher(start_label, rel_type, end_label, start_fields, end_fields)
                for batch_index, chunk in enumerate(_chunked(bucket, self.edge_batch_size), start=1):
                    rows = [
                        {
                            "start": edge.start.to_dict(),
                            "end": edge.end.to_dict(),
                            "props": {k: v for k, v in (edge.properties or {}).items() if v is not None},
                        }
                        for edge in chunk
                    ]
                    _emit_log(
                        "info",
                        "neo4j_edges_batch_start",
                        context,
                        rel_type=rel_type,
                        start_label=start_label,
                        end_label=end_label,
                        batch_index=batch_index,
                        batch_size=len(rows),
                    )
                    start_time = time.monotonic()

                    def run_edges() -> None:
                        session.execute_write(lambda tx: tx.run(cypher, edges=rows).consume())

                    self._execute_with_retry(
                        run_edges,
                        context,
                        batch_kind="edges",
                        batch_index=batch_index,
                        batch_size=len(rows),
                        rel_type=rel_type,
                        label=f"{start_label}->{end_label}",
                    )
                    duration_ms = int((time.monotonic() - start_time) * 1000)
                    _emit_log(
                        "info",
                        "neo4j_edges_batch_end",
                        context,
                        rel_type=rel_type,
                        start_label=start_label,
                        end_label=end_label,
                        batch_index=batch_index,
                        batch_size=len(rows),
                        duration_ms=duration_ms,
                    )
                    if on_edges_batch:
                        on_edges_batch(len(rows))

        return node_map

    def _execute_with_retry(
        self,
        operation: Callable[[], Sequence[dict] | None],
        context: Dict[str, str],
        *,
        batch_kind: str,
        batch_index: int,
        batch_size: int,
        label: str | None = None,
        rel_type: str | None = None,
    ) -> Sequence[dict] | None:
        attempts_allowed = self.max_attempts
        attempt = 1
        while True:
            try:
                return operation()
            except Neo4jError as exc:
                _emit_log(
                    "error",
                    "neo4j_batch_failed",
                    context,
                    batch_kind=batch_kind,
                    batch_index=batch_index,
                    batch_size=batch_size,
                    attempt=attempt,
                    max_attempts=attempts_allowed,
                    label=label,
                    rel_type=rel_type,
                    code=getattr(exc, "code", type(exc).__name__),
                    message=str(exc),
                )
                if attempt >= attempts_allowed:
                    raise
                if self.backoff_sec > 0:
                    time.sleep(self.backoff_sec)
                attempt += 1

    @staticmethod
    def _derive_node_key_fields(nodes: List[GraphNode]) -> List[str]:
        first = nodes[0]
        key_fields = sorted(first.key.keys())
        for node in nodes[1:]:
            other_keys = sorted(node.key.keys())
            if other_keys != key_fields:
                raise ValueError(
                    f"Inconsistent key fields for label={first.label}: {key_fields} vs {other_keys}"
                )
        return key_fields

    @staticmethod
    def _build_node_rows(chunk: List[GraphNode]) -> Tuple[List[dict], Dict[str, NodeKey]]:
        rows: List[dict] = []
        lookup: Dict[str, NodeKey] = {}
        for node in chunk:
            node_key = node.node_key()
            key_hash = _key_hash(node_key)
            rows.append(
                {
                    "key": {k: v for k, v in node.key.items()},
                    "props": {k: v for k, v in (node.properties or {}).items() if v is not None},
                    "key_hash": key_hash,
                }
            )
            lookup[key_hash] = node_key
        return rows, lookup

    @staticmethod
    def _derive_edge_fields(edges: List[GraphEdge]) -> Tuple[List[str], List[str]]:
        first = edges[0]
        start_fields = [key for key, _ in first.start.key]
        end_fields = [key for key, _ in first.end.key]
        for edge in edges[1:]:
            if [key for key, _ in edge.start.key] != start_fields:
                raise ValueError(
                    f"Inconsistent start node keys for relationship {first.type}: {start_fields} vs "
                    f"{[key for key, _ in edge.start.key]}"
                )
            if [key for key, _ in edge.end.key] != end_fields:
                raise ValueError(
                    f"Inconsistent end node keys for relationship {first.type}: {end_fields} vs "
                    f"{[key for key, _ in edge.end.key]}"
                )
        return start_fields, end_fields

    @staticmethod
    def _build_merge_node_cypher(label: str, key_fields: Sequence[str]) -> str:
        key_clause = ", ".join(f"{field}: row.key.{field}" for field in key_fields)
        return (
            f"UNWIND $nodes AS row "
            f"MERGE (n:`{label}` {{ {key_clause} }}) "
            "SET n += row.props "
            "RETURN row.key_hash AS key_hash, elementId(n) AS element_id"
        )

    @staticmethod
    def _build_merge_edge_cypher(
        start_label: str,
        rel_type: str,
        end_label: str,
        start_fields: Sequence[str],
        end_fields: Sequence[str],
    ) -> str:
        start_clause = ", ".join(f"{field}: edge.start.{field}" for field in start_fields)
        end_clause = ", ".join(f"{field}: edge.end.{field}" for field in end_fields)
        return (
            "UNWIND $edges AS edge "
            f"MATCH (s:`{start_label}` {{ {start_clause} }}) "
            f"MATCH (e:`{end_label}` {{ {end_clause} }}) "
            f"MERGE (s)-[r:`{rel_type}`]->(e) "
            "SET r += edge.props"
        )
