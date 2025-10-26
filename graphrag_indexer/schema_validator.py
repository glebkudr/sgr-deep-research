from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Set

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None

from .models import ExtractionResult, GraphEdge, GraphNode, TextUnit


logger = logging.getLogger(__name__)


class SchemaValidationError(ValueError):
    """Raised when extracted data violates the ontology contract."""


@dataclass(frozen=True)
class NodeSpec:
    label: str
    required: Set[str]
    allowed: Set[str]


class SchemaValidator:
    """Validates extracted nodes/edges against the JSON schema contract."""

    _REPO_ROOT = Path(__file__).resolve().parent.parent
    DEFAULT_CONFIG_PATH = _REPO_ROOT / "services" / "indexer" / "schema" / "kg_1c_v2.yaml"
    DEFAULT_SCHEMA_PATH = _REPO_ROOT / "services" / "indexer" / "schema" / "schema_1c_v2.json"

    def __init__(self, schema_path: Path) -> None:
        self.schema_path = schema_path
        self._load_schema(schema_path)

    @classmethod
    def from_config(cls) -> "SchemaValidator":
        config_env = os.getenv("GRAPH_SCHEMA_CONFIG")
        config_path = Path(config_env) if config_env else cls.DEFAULT_CONFIG_PATH
        schema_path: Optional[Path] = None

        if config_path.exists():
            schema_path = cls._schema_path_from_yaml(config_path)
        else:
            logger.info("Schema config %s not found; falling back to JSON schema only.", config_path)

        if schema_path is None:
            schema_env = os.getenv("GRAPH_SCHEMA_PATH")
            schema_path = Path(schema_env) if schema_env else cls.DEFAULT_SCHEMA_PATH

        if not schema_path.exists():
            raise FileNotFoundError(f"Schema file not found: {schema_path}")

        return cls(schema_path)

    @staticmethod
    def _schema_path_from_yaml(config_path: Path) -> Optional[Path]:
        if yaml is None:
            logger.warning(
                "PyYAML is not installed, unable to parse %s; using adjacent JSON schema instead.",
                config_path,
            )
            return config_path.parent / "schema_1c_v2.json"

        with config_path.open(encoding="utf-8") as handle:
            config = yaml.safe_load(handle)

        schema_entry = config.get("schema") if isinstance(config, dict) else None
        if isinstance(schema_entry, dict):
            file_value = schema_entry.get("${file}")
        else:
            file_value = schema_entry

        if not file_value:
            logger.warning("Schema path not specified in %s; using default JSON schema.", config_path)
            return config_path.parent / "schema_1c_v2.json"

        return (config_path.parent / Path(file_value)).resolve()

    def _load_schema(self, schema_path: Path) -> None:
        with schema_path.open(encoding="utf-8") as handle:
            data = json.load(handle)

        self._node_specs: Dict[str, NodeSpec] = {}
        for node in data["node_types"]:
            label = node["label"]
            properties = node.get("properties", [])
            allowed = {prop["name"] for prop in properties}
            required = {prop["name"] for prop in properties if prop.get("required")}
            self._node_specs[label] = NodeSpec(label=label, required=required, allowed=allowed)

        self._allowed_relationships: Set[str] = set(data.get("relationship_types", []))
        self._additional_node_types = data.get("additional_node_types", True)
        self._additional_relationship_types = data.get("additional_relationship_types", True)
        self._additional_properties_allowed = data.get("additional_properties_allowed", True)

    def validate(self, extraction: ExtractionResult, *, source: str | None = None) -> None:
        for node in extraction.nodes:
            self._validate_node(node, source)
        for edge in extraction.edges:
            self._validate_edge(edge, source)
        for text_unit in extraction.text_units:
            self._validate_text_unit(text_unit, source)

    def _validate_node(self, node: GraphNode, source: Optional[str]) -> None:
        spec = self._node_specs.get(node.label)
        if spec is None:
            if self._additional_node_types:
                return
            raise SchemaValidationError(self._message(f"Unknown node label '{node.label}'", source))

        if not self._additional_properties_allowed:
            unknown_props = set(node.properties.keys()) - spec.allowed
            if unknown_props:
                self._fail(
                    message=f"Node '{node.label}' contains unsupported properties: {sorted(unknown_props)}",
                    source=source,
                    label=node.label,
                    unknown_properties=sorted(unknown_props),
                )

        missing_required = [prop for prop in spec.required if node.properties.get(prop) in (None, "")]
        if missing_required:
            self._fail(
                message=f"Node '{node.label}' missing required properties: {missing_required}",
                source=source,
                label=node.label,
                missing_properties=missing_required,
            )

    def _validate_edge(self, edge: GraphEdge, source: Optional[str]) -> None:
        if edge.type not in self._allowed_relationships:
            if self._additional_relationship_types:
                return
            self._fail(
                message=f"Unknown relationship type '{edge.type}'",
                source=source,
                relationship_type=edge.type,
            )

        if not edge.start or not edge.end:
            self._fail(
                message="Edge must have start and end node keys",
                source=source,
                relationship_type=edge.type,
            )

    def _validate_text_unit(self, text_unit: TextUnit, source: Optional[str]) -> None:
        if not text_unit.path or not text_unit.path.strip():
            self._fail(
                message="TextUnit missing required file path",
                source=source,
                node_label=text_unit.node_key.label,
                node_key=dict(text_unit.node_key.key),
            )

    @staticmethod
    def _message(message: str, source: Optional[str]) -> str:
        if source:
            return f"{message} (source: {source})"
        return message

    def _fail(self, *, message: str, source: Optional[str], **context: object) -> None:
        logger.error(
            "event=schema_validation_failed message=%s source=%s context=%s",
            message,
            source or "<unknown>",
            context,
        )
        raise SchemaValidationError(self._message(message, source))


__all__ = ["SchemaValidator", "SchemaValidationError"]
