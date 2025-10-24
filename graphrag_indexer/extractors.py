from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
import xml.etree.ElementTree as ET

from .loader import LoadedDocument
from .models import ExtractionResult, GraphEdge, GraphNode, NodeKey, TextUnit
from .utils import stable_guid


logger = logging.getLogger(__name__)


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
    "Документ": "Document",
    "Справочник": "Catalog",
    "ПланОбмена": "ExchangePlan",
    "ПланВидовХарактеристик": "ChartOfCharacteristicTypes",
}

REGISTER_READ_TOKENS = (
    "Выбрать",
    "Получить",
    "Найти",
    "СрезПервых",
    "Подбор",
    "Select",
    "Get",
)

REGISTER_WRITE_TOKENS = (
    "Записать",
    "Запись",
    "Добавить",
    "СоздатьНаборЗаписей",
    "Write",
    "Post",
)


@dataclass
class RegisterUsage:
    name: str
    label: str
    operations: Set[str]


def extract_document(document: LoadedDocument) -> ExtractionResult:
    if document.extension == ".bsl":
        return _extract_bsl(document)
    if document.extension in {".html", ".htm"}:
        return _extract_html(document)
    if document.extension == ".xml":
        return _extract_xml_by_path(document)
    if document.extension == ".txt":
        return _extract_text(document)
    logger.warning("Unhandled extension %s for %s; defaulting to text extraction.", document.extension, document.rel_path)
    return _extract_text(document)


def _build_object_and_module(
    document: LoadedDocument,
) -> Tuple[GraphNode, NodeKey, Optional[GraphNode], List[GraphEdge], Optional[str]]:
    rel_path = Path(document.rel_path)
    parts = rel_path.parts

    edges: List[GraphEdge] = []
    object_node: Optional[GraphNode] = None
    owner_qn: Optional[str] = None

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
        owner_qn = qualified_name

    module_name = rel_path.stem
    module_kind = MODULE_KIND_MAP.get(module_name, None)
    if not module_kind and len(parts) > 2:
        module_kind = MODULE_KIND_MAP.get(parts[2].split(".")[0], "CommonModule")
    module_guid = stable_guid(f"{document.rel_path}:module")

    module_properties = {
        "name": module_name,
        "kind": module_kind or "CommonModule",
        "guid": module_guid,
        "path": document.rel_path,
    }
    if owner_qn:
        module_properties["owner_qn"] = owner_qn

    module_node = GraphNode(
        label="Module",
        key={"guid": module_guid},
        properties=module_properties,
    )
    module_key = module_node.node_key()

    if object_node:
        object_key = object_node.node_key()
        edges.append(GraphEdge(start=object_key, type="HAS_MODULE", end=module_key))
        edges.append(GraphEdge(start=module_key, type="OWNED_BY", end=object_key))

    return module_node, module_key, object_node, edges, owner_qn


def _extract_xml_by_path(document: LoadedDocument) -> ExtractionResult:
    parts = Path(document.rel_path).parts
    if _looks_like_form_xml(parts):
        return _extract_form_xml(document)
    if parts and parts[0] == "Roles":
        return _extract_role_xml(document)
    if parts and parts[0] == "HTTPServices":
        return _extract_http_service_xml(document)
    if parts and parts[0] == "DocumentJournals":
        return _extract_document_journal_xml(document)
    return _extract_generic_xml(document)


def _looks_like_form_xml(parts: Tuple[str, ...]) -> bool:
    lowered = tuple(part.lower() for part in parts)
    if "forms" in lowered:
        return True
    if lowered[-1:] == ("form.xml",):
        return True
    if lowered[-2:] == ("ext", "form.xml"):
        return True
    return False


def _parse_xml_root(document: LoadedDocument) -> ET.Element:
    try:
        return ET.fromstring(document.content)
    except ET.ParseError as exc:
        logger.error("Failed to parse XML %s: %s", document.rel_path, exc)
        raise ValueError(f"Invalid XML in {document.rel_path}: {exc}") from exc


def _local_name(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _text_or_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _first_descendant_text(element: ET.Element, candidates: Tuple[str, ...]) -> Optional[str]:
    for descendant in element.iter():
        if _local_name(descendant.tag) in candidates:
            text = _text_or_none(descendant.text)
            if text:
                return text
    return None


def _build_object_node_from_reference(reference: str) -> GraphNode:
    parts = reference.split(".", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid metadata reference '{reference}'")
    obj_type, obj_name = parts
    return GraphNode(
        label="Object",
        key={"qualified_name": reference},
        properties={
            "qualified_name": reference,
            "type": obj_type,
            "name": obj_name,
        },
    )


ROLE_ACTION_MAP = {
    "Read": "Read",
    "Write": "Write",
    "Insert": "Insert",
    "Delete": "Delete",
    "Execute": "Execute",
    "View": "View",
    "Post": "Post",
    "Unpost": "Unpost",
    "Чтение": "Read",
    "Запись": "Write",
    "Изменение": "Write",
    "Добавление": "Insert",
    "Удаление": "Delete",
    "Просмотр": "View",
    "Проведение": "Post",
    "ОтменаПроведения": "Unpost",
}


def _normalize_role_action(name: str) -> tuple[str, Optional[str]]:
    cleaned = name.strip()
    if not cleaned:
        return ("Custom", None)
    mapped = ROLE_ACTION_MAP.get(cleaned)
    if mapped:
        return (mapped, None)
    capitalized = cleaned.capitalize()
    mapped = ROLE_ACTION_MAP.get(capitalized)
    if mapped:
        return (mapped, None)
    upper = cleaned.upper()
    mapped = ROLE_ACTION_MAP.get(upper)
    if mapped:
        return (mapped, None)
    return ("Custom", cleaned)


def _extract_role_actions(element: ET.Element) -> List[tuple[str, Optional[str]]]:
    actions: List[tuple[str, Optional[str]]] = []
    for child in element:
        local = _local_name(child.tag)
        text = _text_or_none(child.text)
        if local.lower() in {"right", "value"} and text:
            actions.append(_normalize_role_action(text))
        elif local in ROLE_ACTION_MAP and text and text.lower() in {"true", "1"}:
            actions.append(_normalize_role_action(local))
        actions.extend(_extract_role_actions(child))
    return actions


def _extract_register_usages(body: str) -> List[RegisterUsage]:
    usages: Dict[Tuple[str, str], RegisterUsage] = {}
    for prefix, label in REGISTER_PREFIXES.items():
        pattern = re.compile(rf"{prefix}\.([A-Za-z\u0400-\u04FF_][\w]*)", flags=re.UNICODE)
        for match in pattern.finditer(body):
            name = match.group(1)
            operations: Set[str] = set()
            context_slice = body[max(0, match.start() - 200) : match.end() + 200]
            lower_context = context_slice.lower()
            if any(token.lower() in lower_context for token in REGISTER_READ_TOKENS):
                operations.add("read")
            if any(token.lower() in lower_context for token in REGISTER_WRITE_TOKENS):
                operations.add("write")
            key = (label, name)
            if key not in usages:
                usages[key] = RegisterUsage(name=name, label=label, operations=operations or {"read"})
            else:
                usages[key].operations.update(operations or {"read"})
    return list(usages.values())



def _extract_bsl(document: LoadedDocument) -> ExtractionResult:
    _routine_bodies.clear()
    module_node, module_key, object_node, edges, owner_qn = _build_object_and_module(document)

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
            r"^(Процедура|Функция|Procedure|Function)\s+([A-Za-zЀ-ӿ_][\w]*)\s*\((.*?)\)\s*(.*)$",
            stripped,
            flags=re.IGNORECASE,
        )
        if routine_match:
            if current_routine_name:
                _finalize_routine(
                    result,
                    module_key,
                    owner_qn,
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
                owner_qn,
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
            owner_qn,
            current_routine_name,
            current_signature or "",
            current_export,
            current_exec_side,
            "\n".join(current_routine_lines),
            routine_map,
        )

    module_registers: Dict[Tuple[str, str], RegisterUsage] = {}

    _seen_registers: Dict[str, NodeKey] = {}

    for routine_name, node_key in routine_map.items():
        body = _routine_bodies.get(node_key)
        if not body:
            continue
        calls = _extract_calls(body, routine_map)
        for target in calls:
            target_key = routine_map.get(target)
            if target_key:
                result.edges.append(GraphEdge(start=node_key, type="CALLS", end=target_key))

        for usage in _extract_register_usages(body):
            key = (usage.label, usage.name)
            existing = module_registers.get(key)
            if existing is None:
                module_registers[key] = RegisterUsage(name=usage.name, label=usage.label, operations=set(usage.operations))
            else:
                existing.operations.update(usage.operations)

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

    for usage in module_registers.values():
        guid = stable_guid(f"{usage.label}:{usage.name}")
        register_node = GraphNode(
            label=usage.label,
            key={"guid": guid},
            properties={"name": usage.name, "guid": guid},
        )
        register_key = register_node.node_key()
        if guid not in _seen_registers:
            result.nodes.append(register_node)
            _seen_registers[guid] = register_key
        else:
            register_key = _seen_registers[guid]
        if "read" in usage.operations:
            result.edges.append(GraphEdge(start=module_key, type="READS_FROM", end=register_key))
        if "write" in usage.operations:
            result.edges.append(GraphEdge(start=module_key, type="WRITES_TO", end=register_key))
            if object_node and object_node.properties.get("type") == "Document" and usage.label == "AccumulationRegister":
                result.edges.append(GraphEdge(start=object_node.node_key(), type="MAKES_MOVEMENTS_IN", end=register_key))

    return result



_routine_bodies: Dict[NodeKey, str] = {}


def _determine_exec_side(directives: List[str]) -> str:
    for directive in directives:
        token = directive.strip().strip("()").replace("&", "")
        if token in EXEC_SIDE_DIRECTIVES:
            return EXEC_SIDE_DIRECTIVES[token]
    return "Unknown"


def _finalize_routine(
    result: ExtractionResult,
    module_key: NodeKey,
    owner_qn: Optional[str],
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
            "owner_qn": owner_qn,
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



def _extract_references(body: str) -> List[Tuple[str, str]]:
    matches: List[Tuple[str, str]] = []
    for prefix, label in REFERENCE_PREFIXES.items():
        pattern = re.compile(rf"{prefix}\.([A-Za-zА-Яа-я_][\w]*)", flags=re.UNICODE)
        for match in pattern.finditer(body):
            matches.append((match.group(1), label))
    return matches


def _extract_text(document: LoadedDocument) -> ExtractionResult:
    module_node, module_key, object_node, edges, _ = _build_object_and_module(document)
    nodes = [module_node]
    if object_node:
        nodes.append(object_node)
    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=module_key)
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])


def _extract_role_xml(document: LoadedDocument) -> ExtractionResult:
    root = _parse_xml_root(document)
    role_name = _first_descendant_text(root, ("Name",))
    if not role_name:
        parts = Path(document.rel_path).parts
        if parts:
            candidate = parts[-1]
            role_name = parts[-2] if candidate.lower().endswith('.xml') and len(parts) >= 2 else Path(candidate).stem
    if not role_name:
        raise ValueError(f"Unable to determine role name for {document.rel_path}")

    role_node = GraphNode(label="Role", key={"name": role_name}, properties={"name": role_name})
    nodes: List[GraphNode] = [role_node]
    edges: List[GraphEdge] = []
    role_key = role_node.node_key()

    object_nodes: Dict[str, GraphNode] = {}

    for rights_block in root.iter():
        if _local_name(rights_block.tag) not in {"ObjectRight", "Rights"}:
            continue
        reference = _first_descendant_text(rights_block, ("Object", "MetadataObject"))
        if not reference:
            continue
        object_node = object_nodes.get(reference)
        if object_node is None:
            object_node = _build_object_node_from_reference(reference)
            object_nodes[reference] = object_node
            nodes.append(object_node)
        object_key = object_node.node_key()
        edges.append(GraphEdge(start=role_key, type="ROLE_HAS_ACCESS_TO", end=object_key))

        condition = _first_descendant_text(rights_block, ("Condition", "Filter", "Expression"))
        details_text = _first_descendant_text(
            rights_block,
            ("Comment", "Note", "Details", "Комментарий", "Примечание"),
        )

        raw_actions = {(action, extra) for action, extra in _extract_role_actions(rights_block)}
        if not raw_actions:
            raw_actions = {("Custom", details_text)}

        for action, extra in raw_actions:
            normalized_details = extra if extra else details_text
            ar_guid = stable_guid(f"role:{role_name}:{reference}:{action}:{condition or ''}:{normalized_details or ''}")
            properties: Dict[str, Optional[str]] = {"guid": ar_guid, "action": action}
            if condition:
                properties["condition"] = condition
            if normalized_details:
                properties["details"] = normalized_details
            access_node = GraphNode(label="AccessRight", key={"guid": ar_guid}, properties=properties)
            nodes.append(access_node)
            access_key = access_node.node_key()
            edges.append(GraphEdge(start=role_key, type="GRANTS", end=access_key))
            edges.append(GraphEdge(start=access_key, type="PERMITS", end=object_key))

    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=role_key)
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])


def _extract_http_service_xml(document: LoadedDocument) -> ExtractionResult:
    root = _parse_xml_root(document)
    service_name = _first_descendant_text(root, ("Name",))
    if not service_name:
        parts = Path(document.rel_path).parts
        if parts:
            service_name = Path(parts[-1]).stem
    if not service_name:
        raise ValueError(f"Unable to determine HTTP service name for {document.rel_path}")

    service_node = GraphNode(label="HTTPService", key={"name": service_name}, properties={"name": service_name})
    nodes: List[GraphNode] = [service_node]
    edges: List[GraphEdge] = []
    service_key = service_node.node_key()

    configuration_name = _first_descendant_text(root, ("ConfigurationName", "Configuration"))
    if configuration_name:
        config_node = GraphNode(label="Configuration", key={"name": configuration_name}, properties={"name": configuration_name})
        nodes.append(config_node)
        edges.append(GraphEdge(start=config_node.node_key(), type="HAS_HTTP_SERVICE", end=service_key))

    for template_elem in root.iter():
        if _local_name(template_elem.tag) != "URLTemplate":
            continue
        template_value = (
            _text_or_none(template_elem.get("template"))
            or _first_descendant_text(template_elem, ("Template", "Value"))
            or _text_or_none(template_elem.text)
        )
        if not template_value:
            continue
        template_node = GraphNode(label="URLTemplate", key={"template": template_value}, properties={"template": template_value})
        nodes.append(template_node)
        template_key = template_node.node_key()
        edges.append(GraphEdge(start=service_key, type="HAS_URL_TEMPLATE", end=template_key))

        methods: Set[str] = set()
        for method_elem in template_elem.iter():
            if _local_name(method_elem.tag) in {"HTTPMethod", "Method", "Verb"}:
                method_value = _text_or_none(method_elem.text)
                if method_value:
                    methods.add(method_value.upper())
        if not methods:
            inherited = _first_descendant_text(root, ("HTTPMethod", "Method"))
            if inherited:
                methods.add(inherited.upper())
        for method in sorted(methods):
            if method not in {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"}:
                logger.warning("Unsupported HTTP method '%s' in %s; skipping.", method, document.rel_path)
                continue
            method_node = GraphNode(label="HTTPMethod", key={"method": method}, properties={"method": method})
            nodes.append(method_node)
            edges.append(GraphEdge(start=template_key, type="HAS_URL_METHOD", end=method_node.node_key()))

    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=service_key)
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])


def _extract_document_journal_xml(document: LoadedDocument) -> ExtractionResult:
    root = _parse_xml_root(document)
    journal_name = _first_descendant_text(root, ("Name",))
    if not journal_name:
        parts = Path(document.rel_path).parts
        if parts:
            journal_name = Path(parts[-1]).stem
    if not journal_name:
        raise ValueError(f"Unable to determine document journal name for {document.rel_path}")

    journal_node = GraphNode(label="DocumentJournal", key={"name": journal_name}, properties={"name": journal_name})
    nodes: List[GraphNode] = [journal_node]
    edges: List[GraphEdge] = []
    journal_key = journal_node.node_key()

    seen_references: Set[str] = set()

    for doc_elem in root.iter():
        if _local_name(doc_elem.tag) not in {"Document", "MetadataObject"}:
            continue
        doc_ref = _text_or_none(doc_elem.text)
        if not doc_ref or doc_ref in seen_references:
            continue
        seen_references.add(doc_ref)
        object_node = _build_object_node_from_reference(doc_ref)
        nodes.append(object_node)
        object_key = object_node.node_key()
        edges.append(GraphEdge(start=journal_key, type="CONTAINS", end=object_key))
        edges.append(GraphEdge(start=object_key, type="JOURNALED_IN", end=journal_key))

    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=journal_key)
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])


def _extract_generic_xml(document: LoadedDocument) -> ExtractionResult:
    document_node = GraphNode(label="Document", key={"path": document.rel_path}, properties={"path": document.rel_path})
    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=document_node.node_key())
    return ExtractionResult(nodes=[document_node], edges=[], text_units=[text_unit])

def _extract_form_xml(document: LoadedDocument) -> ExtractionResult:
    module_node, module_key, object_node, edges, owner_qn = _build_object_and_module(document)
    nodes = [module_node]
    if object_node:
        nodes.append(object_node)
    else:
        raise ValueError(f"Unable to determine owning object for form {document.rel_path}")

    form_guid = stable_guid(f"{document.rel_path}:form")
    form_node = GraphNode(
        label="Form",
        key={"guid": form_guid},
        properties={"name": Path(document.rel_path).stem, "guid": form_guid, "owner_qn": owner_qn},
    )
    nodes.append(form_node)
    edges.append(GraphEdge(start=object_node.node_key(), type="HAS_FORM", end=form_node.node_key()))

    text_unit = TextUnit(text=document.content, path=document.rel_path, node_key=form_node.node_key())
    return ExtractionResult(nodes=nodes, edges=edges, text_units=[text_unit])

def _extract_html(document: LoadedDocument) -> ExtractionResult:
    # Treat HTML similar to plain text but attach to module.
    return _extract_text(document)
