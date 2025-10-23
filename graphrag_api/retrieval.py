from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

from graphrag_service.config import get_settings
from graphrag_service.embeddings import OpenAIEmbeddingClient
from graphrag_service.llm import OpenAIChatClient
from graphrag_service.neo4j_client import neo4j_session
from graphrag_service.vector_store import FaissVectorStore, VectorHit


logger = logging.getLogger(__name__)

INSUFFICIENT_ANSWER = (
    "\u0418\u0437\u0432\u0438\u043d\u0438\u0442\u0435, "
    "\u044f \u043d\u0435 \u043d\u0430\u0448\u0451\u043b "
    "\u043f\u043e\u0434\u0445\u043e\u0434\u044f\u0449\u0435\u0433\u043e \u043e\u0442\u0432\u0435\u0442\u0430."
)


@dataclass
class RetrievalResult:
    answer: str
    citations: List[dict]
    graph_paths: List[dict]
    cypher_used: List[str]
    confidence: float


class RetrievalService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def answer(self, question: str, collection: str, top_k: int, max_hops: int) -> RetrievalResult:
        logger.info("Retrieval start collection=%s top_k=%d max_hops=%d", collection, top_k, max_hops)
        store = FaissVectorStore(collection)
        try:
            store.load()
        except FileNotFoundError as exc:
            raise RuntimeError(f"Vector index for collection '{collection}' is missing.") from exc

        embedding_client = OpenAIEmbeddingClient()
        query_embedding = embedding_client.embed_texts([question])
        if query_embedding.size == 0:
            raise RuntimeError("Unable to compute embedding for the question.")

        search_k = max(self.settings.qa_default_top_k, top_k * 4)
        hits = store.query(query_embedding[0], top_k=search_k)
        if not hits:
            raise RuntimeError("Vector search returned no candidates.")

        chunk_contexts = self._select_chunk_contexts(hits, top_k)
        seed_ids = [ctx["node_id"] for ctx in chunk_contexts if ctx["node_id"] is not None]
        graph_paths, node_details, cypher_queries = self._expand_graph(seed_ids, max_hops)
        citations = self._build_citations(chunk_contexts, node_details)

        context_text = self._render_context(chunk_contexts, node_details, graph_paths)
        chat_client = OpenAIChatClient()
        system_prompt = (
            "You are a 1C domain analyst. Answer strictly in Russian using only the provided context. "
            f"If the context is insufficient, reply exactly with: \"{INSUFFICIENT_ANSWER}\"."
        )
        user_message = (
            f"Question (reply in Russian):\n{question}\n\n"
            f"Context:\n{context_text}\n\n"
            "Respond in 1-2 sentences and mention supporting facts explicitly when available."
        )
        answer_text = chat_client.complete(system_prompt, [{"role": "user", "content": user_message}]).strip()

        confidence = float(max(ctx["score"] for ctx in chunk_contexts)) if chunk_contexts else 0.0

        return RetrievalResult(
            answer=answer_text,
            citations=citations,
            graph_paths=graph_paths,
            cypher_used=cypher_queries,
            confidence=confidence,
        )

    def _select_chunk_contexts(self, hits: Sequence[VectorHit], top_k: int) -> List[dict]:
        contexts: List[dict] = []
        for hit in hits[:top_k]:
            metadata = hit.metadata or {}
            contexts.append(
                {
                    "chunk_id": metadata.get("chunk_id", hit.chunk_id),
                    "node_id": metadata.get("node_id"),
                    "path": metadata.get("path"),
                    "text": metadata.get("text") or metadata.get("text_snippet", ""),
                    "snippet": metadata.get("text_snippet") or metadata.get("text", "")[:300],
                    "score": float(hit.score),
                }
            )
        return contexts

    def _expand_graph(
        self,
        seed_ids: List[int],
        max_hops: int,
    ) -> Tuple[List[dict], Dict[int, dict], List[str]]:
        if not seed_ids or max_hops <= 0:
            nodes = self._fetch_node_details(seed_ids)
            return [], nodes, []

        allowed = self.settings.qa_allowed_relationships
        limit = self.settings.graph_path_limit
        cypher = (
            "MATCH p=(s)-[r*1..$max_hops]-(t) "
            "WHERE id(s) IN $seed_ids AND ALL(rel IN r WHERE type(rel) IN $allowed) "
            "RETURN DISTINCT p "
            "LIMIT $limit"
        )

        paths: List[dict] = []
        node_ids: set[int] = set(seed_ids)
        with neo4j_session() as session:
            result = session.run(
                cypher,
                seed_ids=seed_ids,
                max_hops=max_hops,
                allowed=allowed,
                limit=limit,
            )
            for record in result:
                path = record["p"]
                nodes = [node.id for node in path.nodes]
                node_ids.update(nodes)
                edges = [
                    {"type": rel.type, "source": rel.start_node.id, "target": rel.end_node.id}
                    for rel in path.relationships
                ]
                paths.append({"node_ids": nodes, "edges": edges})

        node_details = self._fetch_node_details(list(node_ids))
        graph_paths = [
            {
                "nodes": [
                    {
                        "id": node_id,
                        "label": node_details.get(node_id, {}).get("label", "Node"),
                        "title": node_details.get(node_id, {}).get("title"),
                    }
                    for node_id in entry["node_ids"]
                ],
                "edges": entry["edges"],
            }
            for entry in paths
        ]
        return graph_paths, node_details, [cypher] if paths else []

    def _fetch_node_details(self, node_ids: Sequence[int]) -> Dict[int, dict]:
        if not node_ids:
            return {}
        details: Dict[int, dict] = {}
        query = (
            "MATCH (n) "
            "WHERE id(n) IN $ids "
            "RETURN id(n) AS id, labels(n) AS labels, "
            "n.name AS name, n.qualified_name AS qualified_name, n.path AS path, n.type AS type"
        )
        with neo4j_session() as session:
            for record in session.run(query, ids=list(node_ids)):
                labels = record["labels"]
                title = record["name"] or record["qualified_name"] or record["path"]
                details[record["id"]] = {
                    "label": labels[0] if labels else "Node",
                    "labels": labels,
                    "title": title,
                    "path": record["path"],
                    "type": record["type"],
                }
        return details

    def _build_citations(self, chunk_contexts: List[dict], node_details: Dict[int, dict]) -> List[dict]:
        citations: List[dict] = []
        for context in chunk_contexts:
            node_id = context["node_id"]
            node_info = node_details.get(node_id) if node_id is not None else None
            citations.append(
                {
                    "node_id": node_id,
                    "label": node_info["label"] if node_info else None,
                    "title": node_info["title"] if node_info else context["path"],
                    "snippet": context["snippet"],
                    "path": node_info["path"] if node_info else context["path"],
                    "score": context["score"],
                }
            )
        return citations

    def _render_context(
        self,
        chunk_contexts: List[dict],
        node_details: Dict[int, dict],
        graph_paths: List[dict],
    ) -> str:
        lines: List[str] = []
        lines.append("=== Chunks ===")
        for idx, ctx in enumerate(chunk_contexts, start=1):
            lines.append(
                f"[Chunk {idx}] path: {ctx['path']} (node_id={ctx['node_id']}) "
                f"score={ctx['score']:.3f}\n{ctx['text']}"
            )

        if node_details:
            lines.append("\n=== Nodes ===")
            for node_id, info in node_details.items():
                lines.append(f"ID {node_id} [{info['label']}]: {info['title']} (path: {info.get('path')})")

        if graph_paths:
            lines.append("\n=== Graph Paths ===")
            for idx, path in enumerate(graph_paths[:5], start=1):
                node_titles = [node["title"] or str(node["id"]) for node in path["nodes"]]
                lines.append(f"[Path {idx}] {' -> '.join(node_titles)}")
                for edge in path["edges"]:
                    lines.append(f"  {edge['source']} -[{edge['type']}]-> {edge['target']}")

        return "\n".join(lines)
