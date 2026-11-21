"""Keeping credentials out of audit records.

Layers, in order of authority:
1. **Metadata allowlist** (primary): each action declares exactly which keys and value types it may carry
   (``actions.py``). Unknown keys, wrong types, nesting and over-long values are rejected, not dropped, so a mistake
   fails loudly in tests instead of silently writing data. Error messages name keys and types, never values.
2. **Value redaction** (secondary, defence in depth): known credential formats in every free-text field (summary,
   resource id, actor label, client label, metadata strings) are replaced with ``[REDACTED]``. Redaction keeps the
   surrounding context: a database URL keeps its user and host, ``password=…`` keeps the key name.
3. **Database CHECKs** (last line, migration 0004): reject rows that still contain the explicitly supported formats
   (API-key secrets, private keys, AWS access key ids, JWTs, URLs with passwords).

Regex redaction cannot recognise arbitrary secrets (e.g. a random password typed into a free-text field with no
surrounding hint). The allowlists and keeping user input out of audit text remain the real protection.

What is deliberately NOT redacted, because it is legitimate audit information: names, email addresses, masked API-key
prefixes (``dp_live_••••9f2a``), UUIDs, and readable ids such as ``u-<32 hex>`` / ``sess-<32 hex>``.
"""

import re
from typing import Any

from .actions import AuditAction

REDACTED = "[REDACTED]"
MAX_STRING = 200
MAX_LIST_ITEMS = 20

_CREDENTIAL_WORDS = r"password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?"

# (pattern, replacement). Order matters: multi-line and structured formats first, generic ones last.
_RULES: list[tuple[re.Pattern[str], str]] = [
    # PEM private keys (whole block; a truncated block without its END line is redacted to the end of the text).
    (
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\Z)", re.DOTALL),
        REDACTED,
    ),
    # Connection strings with a password: keep scheme, user and host; redact only the password.
    (re.compile(r"\b([a-z][a-z0-9+.\-]*://[^\s:/@]+:)(?!\[REDACTED\])[^\s@/]+(@)", re.IGNORECASE), rf"\1{REDACTED}\2"),
    # key=value / key: value pairs whose key names a credential (password=…, aws_secret_access_key: …, token=…).
    (
        re.compile(
            rf"\b((?:[a-z0-9]+[_-])*(?:{_CREDENTIAL_WORDS}))(\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&\"']+)",
            re.IGNORECASE,
        ),
        rf"\1\2{REDACTED}",
    ),
    # Authorization headers.
    (re.compile(r"\bBearer\s+\S+", re.IGNORECASE), REDACTED),
    # JSON Web Tokens (header.payload.signature, header always starts with eyJ).
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"), REDACTED),
    # AWS access key ids.
    (re.compile(r"\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|AKPA|ANPA|ANVA|AROA|APKA|ASCA)[A-Z0-9]{16}\b"), REDACTED),
    # Well-known OAuth / platform tokens: GitHub, GitLab, Slack, Google, Stripe.
    (
        re.compile(
            r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}"
            r"|xox[abposr]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})"
        ),
        REDACTED,
    ),
    # DataPilot API-key secrets (the masked "dp_live_••••9f2a" prefix never matches).
    (re.compile(r"dp_live_[0-9a-f]{8,}", re.IGNORECASE), REDACTED),
    # Password hashes.
    (re.compile(r"\$argon2(?:id|i|d)\$\S+"), REDACTED),
    # Long standalone hex (raw tokens, digests). Not when it is part of an identifier such as "u-<hex>".
    (re.compile(r"(?<![\w-])[0-9a-f]{32,}(?![\w-])", re.IGNORECASE), REDACTED),
]


def redact(text: str) -> str:
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    return text


def _check_str(action: str, key: str, value: Any, limit: int = MAX_STRING) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{action}: metadata {key!r} must be a string")
    if len(value) > limit:
        raise ValueError(f"{action}: metadata {key!r} is longer than {limit} characters")
    return redact(value)


def clean_metadata(action: AuditAction, metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Validates ``metadata`` against the action's allowlist and returns a redacted copy. Raises ValueError (whose
    message names the key and expected type, never the offending value)."""
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
