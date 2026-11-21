"""Keeping credentials out of audit records.

Layers, in order:
1. **Metadata allowlist** (primary): each action declares exactly which keys and value types it may carry
   (``actions.py``). Unknown keys, wrong types, nesting and over-long values are rejected, not dropped, so a
   mistake fails loudly in tests instead of silently writing data.
2. **Value redaction** (defence in depth): secret-looking substrings in summaries, resource ids and metadata strings
   are replaced with ``[REDACTED]``.
3. **Database CHECKs** (last line): migration 0003 rejects rows whose summary or metadata contain an API-key secret.
"""

import re
from typing import Any

from .actions import AuditAction

REDACTED = "[REDACTED]"
MAX_STRING = 200
MAX_LIST_ITEMS = 20

_SECRET_PATTERNS = [
    re.compile(r"dp_live_[0-9a-f]{8,}", re.IGNORECASE),  # API-key secrets (the masked "dp_live_••••9f2a" never matches)
    re.compile(r"\$argon2(id|i|d)\$\S+"),  # password hashes
    re.compile(r"\bBearer\s+\S+", re.IGNORECASE),  # authorization headers
    re.compile(r"\b[0-9a-f]{32,}\b", re.IGNORECASE),  # long hex: tokens, digests, raw keys
]


def redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text


def _check_str(action: str, key: str, value: Any, limit: int = MAX_STRING) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{action}: metadata {key!r} must be a string")
    if len(value) > limit:
        raise ValueError(f"{action}: metadata {key!r} is longer than {limit} characters")
    return redact(value)


def clean_metadata(action: AuditAction, metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Validates ``metadata`` against the action's allowlist and returns a redacted copy. Raises ValueError."""
    metadata = metadata or {}
    unknown = set(metadata) - set(action.metadata)
    if unknown:
        raise ValueError(f"{action.code}: metadata keys {sorted(unknown)} are not allowed for this action")
    cleaned: dict[str, Any] = {}
    for key, value in metadata.items():
        kind = action.metadata[key]
        if kind == "str":
            cleaned[key] = _check_str(action.code, key, value)
        elif kind == "int":
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValueError(f"{action.code}: metadata {key!r} must be an integer")
            cleaned[key] = value
        elif kind == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{action.code}: metadata {key!r} must be a boolean")
            cleaned[key] = value
        elif kind == "list[str]":
            if not isinstance(value, list | tuple) or len(value) > MAX_LIST_ITEMS:
                raise ValueError(f"{action.code}: metadata {key!r} must be a list of at most {MAX_LIST_ITEMS} strings")
            cleaned[key] = [_check_str(action.code, key, v, limit=100) for v in value]
        else:  # pragma: no cover - the registry only declares the types above
            raise ValueError(f"{action.code}: unsupported metadata type {kind!r}")
    return cleaned
