from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .loader import LoadedDocument
from .models import ExtractionResult, GraphEdge, GraphNode, NodeKey, TextUnit
from .utils import stable_guid


OBJECT_TYPE_MAP = {
    "Catalogs": "Catalog",
    "Documents": "Document",
    "Reports": "Report",
    "DataProcessors": "DataProcessor",
    "InformationRegisters": "InformationRegister",
    "AccumulationRegisters": "AccumulationRegister",
    "ChartsOfCharacteristicTypes": "ChartOfCharacteristicTypes",
    "CommonModules": "CommonModule",
    "Enums": "Enum",
    "Constants": "Constant",
}

MODULE_KIND_MAP = {
    "ObjectModule": "ObjectModule",
    "ManagerModule": "ManagerModule",
    "FormModule": "FormModule",
    "CommandModule": "CommandModule",
    "CommonModule": "CommonModule",
}

EXEC_SIDE_DIRECTIVES = {
    "НаКлиенте": "Client",
    "НаСервере": "Server",
    "НаСервереБезКонтекста": "Server",
    "НаКлиентеНаСервереБезКонтекста": "ClientServer",
    "НаКлиентеНаСервере": "ClientServer",
}

RESERVED_CALL_NAMES = {
    "Если",
    "Тогда",
    "Иначе",
    "КонецЕсли",
    "Для",
    "Каждого",
    "Цикл",
    "КонецЦикла",
    "Попытка",
    "Исключение",
    "КонецПопытки",
    "Возврат",
    "Продолжить",
    "Прервать",
}

REGISTER_PREFIXES = {
    "РегистрыНакопления": "AccumulationRegister",
    "РегистрыСведений": "InformationRegister",
}

REFERENCE_PREFIXES = {
    "Документы": "Document",
    "Справочники": "Catalog",
    "ПланыОбмена": "ExchangePlan",
    "ПланыВидовХарактеристик": "ChartOfCharacteristicTypes",
}


def extract_document(document: LoadedDocument) -> ExtractionResult:
    extractor = {
        ".bsl": _extract_bsl,
        ".txt": _extract_text,
        ".xml": _extract_xml,
        ".html": _extract_html,
        ".htm": _extract_html,
    }.get(document.extension, _extract_text)

    return extractor(document)


def _build_object_and_module(document: LoadedDocument) -> Tuple[GraphNode, NodeKey, Optional[GraphNode], List[GraphEdge]]:
    rel_path = Path(document.rel_path)
    parts = rel_path.parts

    edges: List[GraphEdge] = []
    object_node: Optional[GraphNode] = None

    if len(parts) >= 2:
        root = parts[0]
        obj_type = OBJECT_TYPE_MAP.get(root, "Other")
        name = parts[1]
        qualified_name = f"{root}.{name}"
        object_node = GraphNode(
            label="Object",
            key={"qualified_name": qualified_name},
            properties={
                "qualified_name": qualified_name,
                "type": obj_type,
                "name": name,
                "path": document.rel_path,
            },
        )

    module_name = rel_path.stem
    module_kind = MODULE_KIND_MAP.get(module_name, None)
    if not module_kind and len(parts) > 2:
        module_kind = MODULE_KIND_MAP.get(parts[2].split(".")[0], "CommonModule")
    module_guid = stable_guid(f"{document.rel_path}:module")

    module_node = GraphNode(
        label="Module",
        key={"guid": module_guid},
        properties={
            "name": module_name,
            "kind": module_kind or "CommonModule",
            "guid": module_guid,
            "path": document.rel_path,
        },
    )
    module_key = module_node.node_key()

    if object_node:
        edges.append(GraphEdge(start=module_key, type="OWNED_BY", end=object_node.node_key()))

    return module_node, module_key, object_node, edges


def _extract_bsl(document: LoadedDocument) -> ExtractionResult:
    _routine_bodies.clear()
    module_node, module_key, object_node, edges = _build_object_and_module(document)

    nodes = [module_node]
    if object_node:
        nodes.append(object_node)

    result = ExtractionResult(nodes=nodes, edges=edges, text_units=[])

    directive_buffer: List[str] = []
    routine_map: Dict[str, NodeKey] = {}
    current_routine_lines: List[str] = []
    current_routine_name: Optional[str] = None
    current_signature: Optional[str] = None
    current_export = False
    current_exec_side = "Unknown"

    lines = document.content.splitlines()

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("&"):
            directive_buffer.append(stripped.lstrip("&"))
            continue

        routine_match = re.match(
            r"^(Процедура|Функция|Procedure|Function)\s+([A-Za-zА-Яа-я_][\w]*)\s*\((.*?)\)\s*(.*)$",
            stripped,
            flags=re.IGNORECASE,
        )
        if routine_match:
            # Flush previous routine
            if current_routine_name:
                _finalize_routine(
                    result,
                    module_key,
                    current_routine_name,
                    current_signature or "",
                    current_export,
                    current_exec_side,
                    "\n".join(current_routine_lines),
                    routine_map,
                )

            current_routine_name = routine_match.group(2)
            params = routine_match.group(3).strip()
            tail = routine_match.group(4)
            current_signature = f"{current_routine_name}({params})".strip()
            current_export = "экспорт" in tail.lower() or "export" in tail.lower()
            current_exec_side = _determine_exec_side(directive_buffer)
            current_routine_lines = []
            directive_buffer.clear()
            continue

        end_match = re.match(r"^(КонецПроцедуры|КонецФункции|EndProcedure|EndFunction)", stripped, flags=re.IGNORECASE)
        if end_match and current_routine_name:
            _finalize_routine(
                result,
                module_key,
                current_routine_name,
                current_signature or "",
                current_export,
                current_exec_side,
                "\n".join(current_routine_lines),
                routine_map,
            )
            current_routine_name = None
            current_signature = None
            current_export = False
            current_exec_side = "Unknown"
            current_routine_lines = []
            directive_buffer.clear()
            continue

        if current_routine_name:
            current_routine_lines.append(line)

    if current_routine_name:
        _finalize_routine(
            result,
            module_key,
            current_routine_name,
            current_signature or "",
            current_export,
            current_exec_side,
            "\n".join(current_routine_lines),
            routine_map,
        )

    # Derive CALLS relations
    for routine_name, node_key in routine_map.items():
        body = _routine_bodies.get(node_key)
        if not body:
            continue
        calls = _extract_calls(body, routine_map)
        for target in calls:
            target_key = routine_map.get(target)
            if target_key:
                result.edges.append(GraphEdge(start=node_key, type="CALLS", end=target_key))

        registers = _extract_registers(body)
        for register_name, label in registers:
            guid = stable_guid(f"{label}:{register_name}")
            register_node = GraphNode(
                label=label,
                key={"guid": guid},
                properties={"name": register_name, "guid": guid},
            )
            result.nodes.append(register_node)
            result.edges.append(GraphEdge(start=node_key, type="READS_FROM", end=register_node.node_key()))

        references = _extract_references(body)
        for ref_name, label in references:
            guid = stable_guid(f"{label}:{ref_name}")
            ref_node = GraphNode(
                label="Object",
                key={"qualified_name": f"{label}.{ref_name}"},
                properties={"qualified_name": f"{label}.{ref_name}", "type": label, "name": ref_name},
            )
            result.nodes.append(ref_node)
            result.edges.append(GraphEdge(start=node_key, type="REFERENCES", end=ref_node.node_key()))

    return result


_routine_bodies: Dict[NodeKey, str] = {}


def _determine_exec_side(directives: List[str]) -> str:
    for directive in directives:
        clean = directive.strip()
        if clean.startswith("На"):
            name = clean.replace("Диалог", "").replace("()", "")
            if name in EXEC_SIDE_DIRECTIVES:
                return EXEC_SIDE_DIRECTIVES[name]
    return "Unknown"


def _finalize_routine(
    result: ExtractionResult,
    module_key: NodeKey,
    name: str,
    signature: str,
    export: bool,
    exec_side: str,
    body: str,
    routine_map: Dict[str, NodeKey],
) -> None:
    routine_guid = stable_guid(f"{module_key.label}:{module_key.key}:{name}")
    node = GraphNode(
        label="Routine",
        key={"guid": routine_guid},
        properties={
            "name": name,
            "signature": signature,
            "export": export,
            "exec_side": exec_side,
            "guid": routine_guid,
        },
    )
    result.nodes.append(node)
    result.edges.append(GraphEdge(start=module_key, type="HAS_ROUTINE", end=node.node_key()))
    text_unit = TextUnit(text=body, path=signature or name, node_key=node.node_key())
    result.text_units.append(text_unit)
    routine_map[name] = node.node_key()
    _routine_bodies[node.node_key()] = body


def _extract_calls(body: str, routine_map: Dict[str, NodeKey]) -> List[str]:
    pattern = re.compile(r"([A-Za-zА-Яа-я_][\w]*)\s*\(", flags=re.UNICODE)
    names = []
    for match in pattern.finditer(body):
        candidate = match.group(1)
        if candidate in RESERVED_CALL_NAMES:
            continue
        if candidate in routine_map:
            names.append(candidate)
    return names


def _extract_registers(body: str) -> List[Tuple[str, str]]:
    matches: List[Tuple[str, str]] = []
    for prefix, label in REGISTER_PREFIXES.items():
        pattern = re.compile(rf"{prefix}\.([A-Za-zА-Яа-я_][\w]*)", flags=re.UNICODE)
        for match in pattern.finditer(body):
            matches.append((match.group(1), label))
    return matches


def _extract_references(body: str) -> List[Tuple[str, str]]:
    matches: List[Tuple[str, str]] = []
    for prefix, label in REFERENCE_PREFIXES.items():
        pattern = re.compile(rf"{prefix}\.([A-Za-zА-Яа-я_][\w]*)", flags=re.UNICODE)
        for match in pattern.finditer(body):
            matches.append((match.group(1), label))
    return matches


def _extract_text(document: LoadedDocument) -> ExtractionResult:
    module_node, module_key, object_node, edges = _build_object_and_module(document)
    nodes = [module_node]
    if object_node:
        nodes.append(object_node)
    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=module_key)
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])


def _extract_xml(document: LoadedDocument) -> ExtractionResult:
    module_node, module_key, object_node, edges = _build_object_and_module(document)
    nodes = [module_node]
    if object_node:
        nodes.append(object_node)

    form_guid = stable_guid(f"{document.rel_path}:form")
    form_node = GraphNode(
        label="Form",
        key={"guid": form_guid},
        properties={"name": Path(document.rel_path).stem, "guid": form_guid},
    )
    nodes.append(form_node)
    edges.append(GraphEdge(start=module_key, type="HAS_FORM", end=form_node.node_key()))

    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=form_node.node_key())
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])


def _extract_html(document: LoadedDocument) -> ExtractionResult:
    # Treat HTML similar to plain text but attach to module.
    return _extract_text(document)
