from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List


logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".bsl", ".xml", ".html", ".htm", ".txt"}
ENCODINGS = ("utf-8", "cp1251", "windows-1251", "utf-16", "latin-1")


@dataclass
class LoadedDocument:
    path: Path
    rel_path: str
    extension: str
    content: str


def load_documents(root: Path) -> List[LoadedDocument]:
    documents: List[LoadedDocument] = []
    if not root.exists():
        logger.warning("Raw directory %s does not exist.", root)
        return documents

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            continue
        content = _read_file(path)
        rel_path = str(path.relative_to(root))
        documents.append(LoadedDocument(path=path, rel_path=rel_path, extension=ext, content=content))
    return documents


def _read_file(path: Path) -> str:
    for encoding in ENCODINGS:
        try:
            text = path.read_text(encoding=encoding)
            return text.replace("\r\n", "\n").replace("\r", "\n")
        except UnicodeDecodeError:
            continue
    logger.warning("Failed to decode %s with known encodings. Falling back to binary decode.", path)
    return path.read_bytes().decode("utf-8", errors="ignore").replace("\r\n", "\n").replace("\r", "\n")
