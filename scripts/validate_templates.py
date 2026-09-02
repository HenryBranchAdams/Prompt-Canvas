#!/usr/bin/env python3
"""Validate the Prompt Canvas v0.1 template and WebMCP contracts.

Hard schema or manifest failures return a non-zero exit status. Compatibility
lint is reported separately and does not fail the package.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from template_normalization import normalize_template_input

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "prompt-workspace-template.schema.json"
TOOLS_PATH = ROOT / "schemas" / "webmcp-tool-catalog.json"
MANIFEST_PATH = ROOT / "starter-pack" / "manifest.yaml"
TEMPLATE_DIR = ROOT / "starter-pack" / "templates"
PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}")
REQUIRED_WEBMCP_TOOL_NAMES = {
    "prompt_canvas_inspect",
    "prompt_canvas_list_templates",
    "prompt_canvas_get_template",
    "prompt_canvas_validate_template",
    "prompt_canvas_get_generation_context",
    "prompt_canvas_create_workspace",
    "prompt_canvas_update_workspace",
    "prompt_canvas_save_template",
    "prompt_canvas_add_generated_asset",
    "prompt_canvas_manage_outputs",
    "prompt_canvas_delete_workspace",
}


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def path_text(error_path: Any) -> str:
    parts = [str(part) for part in error_path]
    return "/".join(parts) if parts else "<root>"


def lint_template(template: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    prompt = template.get("prompt", {})
    body = prompt.get("body", "")
    negative = prompt.get("negativePrompt", "")
    variables = {item["id"]: item for item in prompt.get("variables", [])}
    placeholders = set(PLACEHOLDER.findall(body + "\n" + negative))

    for variable_id in variables:
        if variable_id not in placeholders:
            warnings.append(
                f"variable `{variable_id}` is not interpolated in prompt text; "
                "use an agent-context control instead if this is intentional"
            )
    for placeholder in sorted(placeholders - variables.keys()):
        warnings.append(f"placeholder `{{{{{placeholder}}}}}` has no declared variable")

    control_ids: set[str] = set()
    for control in template.get("controls", []):
        control_id = control["id"]
        if control_id in control_ids:
            warnings.append(f"duplicate control ID `{control_id}`")
        control_ids.add(control_id)
        binding = control.get("binding") or {}
        if binding.get("mode") == "variable" and binding.get("target") not in variables:
            warnings.append(
                f"control `{control_id}` targets missing variable `{binding.get('target')}`"
            )

    reference_ids = {item["id"] for item in template.get("references", [])}
    operations = set(template.get("generation", {}).get("operations", []))
    capabilities = set(template.get("capabilities", []))
    if operations.intersection({"edit", "variation"}) and not reference_ids and "variations" not in capabilities:
        warnings.append("edit/variation operations are declared without references or a variation capability")
    if "image-to-image" in capabilities and not reference_ids:
        warnings.append("`image-to-image` capability is declared without a reference slot")
    if any(ref.get("required") for ref in template.get("references", [])) and not template.get("preservation"):
        warnings.append("required reference exists without any explicit preservation guidance")

    for output in template.get("outputs", []):
        output_ops = set(output.get("operations", []))
        unsupported = output_ops - operations
        if unsupported:
            warnings.append(
                f"output `{output['id']}` declares unsupported operations: {sorted(unsupported)}"
            )

    controls = template.get("controls", [])
    if len(controls) > 16:
        warnings.append(f"{len(controls)} controls may be dense; confirm they all create leverage")

    source = template.get("source") or {}
    if source.get("promptUsage") in {"adapted", "inspiration-only"}:
        for key in ("title", "creator", "accessedAt"):
            if not source.get(key):
                warnings.append(f"adapted template source is missing `{key}`")

    block_ids = [item["id"] for item in template.get("blocks", [])]
    duplicates = [value for value, count in Counter(block_ids).items() if count > 1]
    if duplicates:
        warnings.append(f"duplicate block IDs: {duplicates}")

    return warnings


def workflow_graph_errors(template: dict[str, Any]) -> list[str]:
    workflow = template.get("workflow") or {}
    stages = workflow.get("stages", [])
    uses_graph_references = (
        workflow.get("mode") == "branching"
        or "entryStageId" in workflow
        or any(stage.get("nextStageIds") for stage in stages)
    )
    if not uses_graph_references:
        return []

    errors: list[str] = []
    stage_ids = [stage["id"] for stage in stages]
    stage_id_set = set(stage_ids)
    duplicate_ids = sorted(
        stage_id for stage_id, count in Counter(stage_ids).items() if count > 1
    )
    if duplicate_ids:
        errors.append(f"workflow has duplicate stage IDs: {duplicate_ids}")

    entry_stage_id = workflow.get("entryStageId")
    if workflow.get("mode") == "branching" and not entry_stage_id:
        errors.append("branching workflow requires entryStageId")
    elif entry_stage_id and entry_stage_id not in stage_id_set:
        errors.append(f"workflow entryStageId `{entry_stage_id}` does not match a stage")

    for stage in stages:
        unknown_next_ids = sorted(set(stage.get("nextStageIds", [])) - stage_id_set)
        if unknown_next_ids:
            errors.append(
                f"workflow stage `{stage['id']}` references unknown next stages: {unknown_next_ids}"
            )
    return errors


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-report", action="store_true")
    args = parser.parse_args()

    errors: list[str] = []
    warnings: dict[str, list[str]] = defaultdict(list)
    checks: list[str] = []

    schema = load_json(SCHEMA_PATH)
    try:
        Draft202012Validator.check_schema(schema)
        checks.append("Template JSON Schema is valid Draft 2020-12.")
    except Exception as exc:  # pragma: no cover - validation utility
        errors.append(f"Template schema is invalid: {exc}")
        validator = None
    else:
        validator = Draft202012Validator(schema, format_checker=FormatChecker())

    manifest = load_yaml(MANIFEST_PATH)
    entries = manifest.get("templates", [])
    expected_template_count = manifest.get("templateCount")
    if expected_template_count != len(entries):
        errors.append(
            f"Manifest templateCount={expected_template_count} but lists {len(entries)} entries"
        )
    manifest_ids = [entry.get("id") for entry in entries]
    if len(set(manifest_ids)) != len(manifest_ids):
        errors.append("Manifest contains duplicate template IDs")

    templates: dict[str, dict[str, Any]] = {}
    template_paths = sorted(TEMPLATE_DIR.glob("*.workspace.yaml"))
    for path in template_paths:
        try:
            template = normalize_template_input(load_yaml(path))
        except Exception as exc:
            errors.append(f"{path.name}: YAML parse failed: {exc}")
            continue
        if not isinstance(template, dict):
            errors.append(f"{path.name}:<root>: template must be an object")
            continue
        template_id = template.get("id", path.stem)
        if template_id in templates:
            errors.append(f"Duplicate template ID `{template_id}`")
        templates[template_id] = template
        template_schema_errors = (
            sorted(validator.iter_errors(template), key=lambda item: list(item.path))
            if validator
            else []
        )
        for error in template_schema_errors:
            errors.append(f"{path.name}:{path_text(error.path)}: {error.message}")
        if validator and not template_schema_errors:
            for graph_error in workflow_graph_errors(template):
                errors.append(f"{path.name}:workflow: {graph_error}")
            warnings[template_id].extend(lint_template(template))

    if len(templates) != expected_template_count:
        errors.append(
            f"Manifest declares {expected_template_count} templates, found {len(templates)}"
        )
    if set(manifest_ids) != set(templates):
        missing = sorted(set(templates) - set(manifest_ids))
        extra = sorted(set(manifest_ids) - set(templates))
        if missing:
            errors.append(f"Templates missing from manifest: {missing}")
        if extra:
            errors.append(f"Manifest IDs without template files: {extra}")

    for entry in entries:
        path = ROOT / "starter-pack" / entry.get("path", "")
        if not path.exists():
            errors.append(f"Manifest path does not exist: {entry.get('path')}")
            continue
        template = load_yaml(path)
        if template.get("id") != entry.get("id"):
            errors.append(
                f"Manifest ID `{entry.get('id')}` does not match file ID `{template.get('id')}`"
            )

    # Canonical examples should be byte-equivalent semantic YAML copies.
    example_pairs = {
        "travel-poster": ROOT / "examples" / "travel-poster.workspace.yaml",
    }
    for template_id, path in example_pairs.items():
        if not path.exists():
            errors.append(f"Missing canonical example: {path.relative_to(ROOT)}")
        elif normalize_template_input(load_yaml(path)) != templates.get(template_id):
            errors.append(f"Example `{path.name}` differs from starter template `{template_id}`")

    tools = load_json(TOOLS_PATH)
    tool_list = tools.get("tools", [])
    names = [item.get("name") for item in tool_list]
    missing_required_tools = sorted(REQUIRED_WEBMCP_TOOL_NAMES - set(names))
    if missing_required_tools:
        errors.append(f"Catalog is missing required WebMCP tools: {missing_required_tools}")
    if len(set(names)) != len(names):
        errors.append("WebMCP tool names are not unique")
    if not all(name and name.startswith("prompt_canvas_") for name in names):
        errors.append("Every WebMCP tool must use the `prompt_canvas_` namespace")
    misleading = {"generate_image", "edit_image", "variation", "upscale"}
    if any(name in misleading for name in names):
        errors.append("Catalog contains a misleading page-owned generation tool")
    for item in tool_list:
        try:
            Draft202012Validator.check_schema(item["inputSchema"])
        except Exception as exc:
            errors.append(f"Tool `{item.get('name')}` has invalid input schema: {exc}")
        if "readOnlyHint" not in item.get("annotations", {}):
            errors.append(f"Tool `{item.get('name')}` is missing readOnlyHint")
    delete_workspace = next(
        (item for item in tool_list if item.get("name") == "prompt_canvas_delete_workspace"),
        None,
    )
    if delete_workspace:
        annotations = delete_workspace.get("annotations", {})
        if not annotations.get("destructiveHint") or not annotations.get("untrustedContentHint"):
            errors.append("Workspace deletion tool must declare destructive and untrusted-content hints")

    families = Counter(
        template.get("compatibility", {}).get("templateFamily", "open")
        for template in templates.values()
    )
    allowed_families = {
        "lightweight",
        "parameterized",
        "reference-transformation",
        "multi-reference",
        "composition-first",
        "multi-stage",
    }
    unknown_families = sorted(set(families) - allowed_families)
    if unknown_families:
        errors.append(f"Starter pack contains unknown template families: {unknown_families}")

    checks.extend(
        [
            f"Validated {len(templates)} starter templates.",
            f"Validated {len(entries)} manifest entries and paths.",
            f"Validated {len(tool_list)} WebMCP tool input schemas.",
            "Confirmed every bundled template uses a supported family.",
            "Confirmed canonical examples match their starter-template sources.",
        ]
    )

    warning_count = sum(len(items) for items in warnings.values())
    report_lines = [
        "# Prompt Canvas Package Validation Report",
        "",
        "**Package:** v0.1  ",
        f"**Hard errors:** {len(errors)}  ",
        f"**Compatibility warnings:** {warning_count}  ",
        "",
        "## Checks",
        "",
    ]
    report_lines.extend(f"- {item}" for item in checks)
    report_lines.extend(["", "## Hard errors", ""])
    report_lines.extend(f"- {item}" for item in errors) if errors else report_lines.append("None.")
    report_lines.extend(["", "## Compatibility lint", ""])
    if warning_count:
        for template_id in sorted(warnings):
            if warnings[template_id]:
                report_lines.append(f"### `{template_id}`")
                report_lines.append("")
                report_lines.extend(f"- {item}" for item in warnings[template_id])
                report_lines.append("")
    else:
        report_lines.append("No compatibility warnings.")

    report_lines.extend(["", "## Family coverage", ""])
    for family, count in sorted(families.items()):
        report_lines.append(f"- `{family}`: {count}")

    report_lines.extend(["", "## Key file digests", ""])
    for path in [SCHEMA_PATH, TOOLS_PATH, MANIFEST_PATH]:
        report_lines.append(f"- `{path.relative_to(ROOT)}`: `{sha256(path)}`")

    if args.write_report:
        (ROOT / "TEMPLATE_VALIDATION_REPORT.md").write_text(
            "\n".join(report_lines) + "\n", encoding="utf-8"
        )

    print(f"Validated {len(templates)} templates and {len(tool_list)} tools")
    print(f"Hard errors: {len(errors)}")
    print(f"Compatibility warnings: {warning_count}")
    for item in errors:
        print(f"ERROR: {item}")
    for template_id, items in warnings.items():
        for item in items:
            print(f"WARN [{template_id}]: {item}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
