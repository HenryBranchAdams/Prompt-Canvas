"""Normalize author-friendly template input into the explicit persisted shape."""
from __future__ import annotations

import copy
import math
import re
from typing import Any

TEMPLATE_SCHEMA = "prompt-canvas.prompt-workspace-template@2"
SLASH_RATIO = re.compile(r"^([1-9][0-9]{0,8})\s*/\s*([1-9][0-9]{0,8})$")
DECIMAL_RATIO = re.compile(r"^(0|[1-9][0-9]{0,8})\.([0-9]{1,9})$")


def normalize_aspect_ratio(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    ratio = value.strip()
    if ratio == "auto":
        return ratio

    slash = SLASH_RATIO.fullmatch(ratio)
    if slash:
        numerator, denominator = (int(part) for part in slash.groups())
    else:
        decimal = DECIMAL_RATIO.fullmatch(ratio)
        if not decimal:
            return value
        whole, fraction = decimal.groups()
        denominator = 10 ** len(fraction)
        numerator = int(whole) * denominator + int(fraction)
        if numerator <= 0:
            return value

    divisor = math.gcd(numerator, denominator)
    return f"{numerator // divisor}:{denominator // divisor}"


def normalize_template_input(candidate: Any) -> Any:
    if not isinstance(candidate, dict):
        return candidate

    normalized = copy.deepcopy(candidate)
    normalized.setdefault("schema", TEMPLATE_SCHEMA)

    generation = normalized.get("generation")
    if isinstance(generation, dict):
        generation.setdefault("provider", "codex")
        generation.setdefault("capability", "image-generation")
        generation.setdefault("delivery", "webmcp-import")

    outputs = normalized.get("outputs")
    if isinstance(outputs, list):
        for output in outputs:
            if isinstance(output, dict) and "aspectRatio" in output:
                output["aspectRatio"] = normalize_aspect_ratio(output["aspectRatio"])

    return normalized
