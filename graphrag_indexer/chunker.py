from __future__ import annotations

from typing import Iterable, List

from .models import Chunk, TextUnit
from .utils import stable_guid


def chunk_text_units(units: Iterable[TextUnit], target_tokens: int = 800, overlap_tokens: int = 120) -> List[Chunk]:
    chunks: List[Chunk] = []
    target_chars = target_tokens * 4
    overlap_chars = overlap_tokens * 4

    for unit in units:
        segments = _chunk_text(unit.text, target_chars, overlap_chars)
        for idx, segment in enumerate(segments):
            locator_component = unit.locator if unit.locator is not None else ""
            seed = f"{unit.node_key.label}|{repr(unit.node_key.key)}|{locator_component}|{idx}"
            chunk_id = stable_guid(seed)
            chunks.append(
                Chunk(
                    chunk_id=chunk_id,
                    text=segment,
                    path=unit.path,
                    locator=unit.locator,
                    node_key=unit.node_key,
                )
            )
    return chunks


def _chunk_text(text: str, target_chars: int, overlap_chars: int) -> List[str]:
    text = text.strip()
    if not text:
        return []

    def _split_long(para: str, limit: int) -> List[str]:
        # Hard split very long paragraphs to ensure each piece <= limit
        return [para[i : i + limit] for i in range(0, len(para), limit)]

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    # Break down oversized paragraphs prior to assembly
    pieces: List[str] = []
    for para in paragraphs:
        if len(para) <= target_chars:
            pieces.append(para)
        else:
            pieces.extend(_split_long(para, target_chars))

    segments: List[str] = []
    current = ""

    def commit(segment: str) -> None:
        if segment:
            segments.append(segment.strip())

    for piece in pieces or _split_long(text, target_chars):
        if len(current) + len(piece) + 2 <= target_chars:
            current = f"{current}\n\n{piece}".strip()
        else:
            commit(current)
            current = piece
    commit(current)

    if not segments:
        # Fallback: ensure we never return an oversize segment
        segments = _split_long(text, target_chars)

    # Apply overlap by merging segments with preceding content
    if overlap_chars > 0 and len(segments) > 1:
        overlapped = []
        prev_tail = ""
        for segment in segments:
            combined = (prev_tail + "\n" + segment).strip() if prev_tail else segment
            overlapped.append(combined)
            prev_tail = segment[-overlap_chars:]
        segments = overlapped

    return segments
