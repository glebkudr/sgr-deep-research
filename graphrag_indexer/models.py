from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass(frozen=True)
class NodeKey:
    label: str
    key: tuple

    @staticmethod
    def from_dict(label: str, key_props: Dict[str, str]) -> "NodeKey":
        key_items = tuple(sorted(key_props.items()))
        return NodeKey(label=label, key=key_items)

    def to_dict(self) -> Dict[str, str]:
        return dict(self.key)


@dataclass
class GraphNode:
    label: str
    key: Dict[str, str]
    properties: Dict[str, str | int | float | bool | None]

    def node_key(self) -> NodeKey:
        return NodeKey.from_dict(self.label, self.key)


@dataclass
class GraphEdge:
    start: NodeKey
    type: str
    end: NodeKey
    properties: Dict[str, str | int | float | bool | None] = field(default_factory=dict)


@dataclass
class Chunk:
    chunk_id: str
    text: str
    path: str
    locator: Optional[str]
    node_key: NodeKey
    summary: Optional[str] = None


@dataclass
class TextUnit:
    text: str
    path: str
    locator: Optional[str]
    node_key: NodeKey


@dataclass
class ExtractionResult:
    nodes: List[GraphNode] = field(default_factory=list)
    edges: List[GraphEdge] = field(default_factory=list)
    text_units: List[TextUnit] = field(default_factory=list)
