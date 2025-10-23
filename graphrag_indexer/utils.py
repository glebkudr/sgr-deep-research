from __future__ import annotations

from uuid import UUID, uuid5

NAMESPACE_UUID = UUID("9d2f4c0a-59ac-4b75-9b8d-7e2d8d2cb3a5")


def stable_guid(value: str) -> str:
    """Generate a deterministic GUID based on a string value."""
    return str(uuid5(NAMESPACE_UUID, value))
