from __future__ import annotations

import re
from pathlib import Path

from .state import RiskLevel

HIGH_RISK_KEYWORDS = {
    "auth", "payment", "billing", "secret", "token", "credential", "password", "infra", "deploy",
    "production", "prod", "migration", "db", "database", "kubernetes", "terraform", "release",
    "publish", "npm publish", "rollback", "delete", "drop", "rm -rf", "force push", "panic",
    "pii", "privacy", "medical", "financial", "security", "compliance"
}

DANGEROUS_COMMANDS = [
    r"\brm\s+-rf\b",
    r"\bmkfs\b",
    r"\bdd\b",
    r"\bgit\s+push\s+-f\b",
    r"\bkubectl\s+apply\b",
    r"\bterraform\s+apply\b",
    r"\bnpm\s+publish\b",
    r"\bdocker\s+push\b",
]

SENSITIVE_PATHS = [".env", "secrets", "secret", "credential", "password", "token", "key", "auth", "billing"]


def risk_from_text(text: str) -> RiskLevel:
    text_l = text.lower()
    score = 0
    for kw in HIGH_RISK_KEYWORDS:
        if kw in text_l:
            score += 2
    for pat in DANGEROUS_COMMANDS:
        if re.search(pat, text_l):
            score += 5
    if score >= 10:
        return RiskLevel.CRITICAL
    if score >= 6:
        return RiskLevel.HIGH
    if score >= 3:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def risk_for_path(path: str | Path) -> RiskLevel:
    p = str(path).lower()
    if any(part in p for part in SENSITIVE_PATHS):
        return RiskLevel.HIGH
    return RiskLevel.LOW


def approval_required(risk: RiskLevel, review_required: bool = False) -> bool:
    if review_required:
        return True
    return risk in {RiskLevel.HIGH, RiskLevel.CRITICAL}
