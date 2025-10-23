from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List, Tuple

from neo4j import Driver

from graphrag_service.config import get_settings
from graphrag_service.neo4j_client import get_neo4j_driver

from .models import GraphEdge, GraphNode, NodeKey


def _key_hash(node_key: NodeKey) -> str:
    return f"{node_key.label}|" + "|".join(f"{k}={v}" for k, v in node_key.key)


class Neo4jGraphWriter:
    def __init__(self, driver: Driver | None = None) -> None:
        self.driver = driver or get_neo4j_driver()
        self.database = get_settings().neo4j_database

    def close(self) -> None:
        self.driver.close()

    def upsert(self, nodes: Iterable[GraphNode], edges: Iterable[GraphEdge]) -> Dict[NodeKey, int]:
        node_map: Dict[NodeKey, int] = {}
        with self.driver.session(database=self.database) as session:
            grouped: Dict[str, List[GraphNode]] = defaultdict(list)
            for node in nodes:
                grouped[node.label].append(node)

            for label, bucket in grouped.items():
                rows = [
                    {
                        "key": node.key,
                        "props": {k: v for k, v in node.properties.items() if v is not None},
                        "key_hash": _key_hash(node.node_key()),
                    }
                    for node in bucket
                ]
                if not rows:
                    continue
                cypher = self._build_merge_node_cypher(label, rows[0]["key"].keys())
                result = session.execute_write(lambda tx: tx.run(cypher, nodes=rows).data())
                for record in result:
                    key_hash = record["key_hash"]
                    node_id = record["node_id"]
                    node_key = bucket[0].node_key()
                    # We need to reconstruct NodeKey from key_hash since bucket order may differ.
                    for node in bucket:
                        if _key_hash(node.node_key()) == key_hash:
                            node_map[node.node_key()] = node_id
                            break

            for edge in edges:
                params = {
                    "start": edge.start.to_dict(),
                    "end": edge.end.to_dict(),
                    "props": edge.properties,
                }
                cypher = self._build_merge_edge_cypher(edge)
                session.execute_write(lambda tx: tx.run(cypher, **params))

        return node_map

    @staticmethod
    def _build_merge_node_cypher(label: str, key_fields: Iterable[str]) -> str:
        key_clause = ", ".join(f"{field}: row.key.{field}" for field in key_fields)
        return (
            f"UNWIND $nodes AS row "
            f"MERGE (n:`{label}` {{ {key_clause} }}) "
            "SET n += row.props "
            "RETURN row.key_hash AS key_hash, id(n) AS node_id"
        )

    @staticmethod
    def _build_merge_edge_cypher(edge: GraphEdge) -> str:
        start_label = edge.start.label
        end_label = edge.end.label
        start_keys = ", ".join(f"{k}: $start.{k}" for k, _ in edge.start.key)
        end_keys = ", ".join(f"{k}: $end.{k}" for k, _ in edge.end.key)
        return (
            f"MATCH (s:`{start_label}` {{ {start_keys} }}) "
            f"MATCH (e:`{end_label}` {{ {end_keys} }}) "
            f"MERGE (s)-[r:`{edge.type}`]->(e) "
            "SET r += $props "
            "RETURN id(r)"
        )
