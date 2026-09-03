#!/usr/bin/env python3
"""Build the deterministic, read-only D1 Official Prompt Library seed."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from template_normalization import normalize_template_input

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "starter-pack" / "manifest.yaml"
SCHEMA_PATH = ROOT / "schemas" / "prompt-workspace-template.schema.json"
OUT_DIR = ROOT / "generated" / "official-library"
OUT_MANIFEST = OUT_DIR / "catalog.json"
OUT_SEED = OUT_DIR / "seed.sql"
VERSION_LOCK = ROOT / "official-library" / "version-lock.json"
SEARCH_EVALUATIONS = ROOT / "official-library" / "search-evaluations.yaml"
DRIZZLE_DIR = ROOT / "drizzle"
DRIZZLE_SCHEMA = DRIZZLE_DIR / "0001_official_prompt_library.sql"


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def pretty(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def digest(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical(value).encode()).hexdigest()


def sql(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def require_strings(discovery: dict[str, Any], key: str, template_id: str, minimum: int = 1) -> list[str]:
    value = discovery.get(key)
    if not isinstance(value, list) or len(value) < minimum or any(not isinstance(item, str) or not item.strip() for item in value):
        raise SystemExit(f"{template_id}: x-discovery.{key} requires at least {minimum} non-empty strings")
    return value


def load_records() -> list[dict[str, Any]]:
    manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    records: list[dict[str, Any]] = []
    seen_slugs: set[str] = set()
    for entry in manifest["templates"]:
        path = MANIFEST_PATH.parent / entry["path"]
        template = normalize_template_input(yaml.safe_load(path.read_text(encoding="utf-8")))
        discovery = template.get("x-discovery")
        # Templates without complete official discovery metadata remain bundled fallback
        # recipes until their owner-reviewed catalog record and thumbnail are ready.
        if not isinstance(discovery, dict):
            continue
        errors = sorted(validator.iter_errors(template), key=lambda item: list(item.path))
        if errors:
            raise SystemExit(f"{entry['id']}: template validation failed: {errors[0].message}")
        if template["id"] != entry["id"]:
            raise SystemExit(f"{entry['id']}: manifest and template IDs differ")
        aliases = require_strings(discovery, "intentAliases", entry["id"], 3)
        required_inputs = require_strings(discovery, "requiredInputSummary", entry["id"])
        intents = require_strings(discovery, "intents", entry["id"])
        input_modes = require_strings(discovery, "inputModes", entry["id"])
        subject_kinds = require_strings(discovery, "subjectKinds", entry["id"])
        output_kinds = require_strings(discovery, "outputKinds", entry["id"])
        preservation = discovery.get("preservationNeeds")
        if not isinstance(preservation, list) or any(not isinstance(item, str) for item in preservation):
            raise SystemExit(f"{entry['id']}: x-discovery.preservationNeeds must be a string array")
        badges = require_strings(discovery, "badges", entry["id"])
        thumbnail = discovery.get("thumbnail")
        if not isinstance(thumbnail, dict) or not thumbnail.get("src") or not thumbnail.get("alt"):
            raise SystemExit(f"{entry['id']}: x-discovery.thumbnail requires src and alt")
        thumbnail_path = ROOT / "public" / str(thumbnail["src"]).lstrip("/")
        if not thumbnail_path.is_file():
            raise SystemExit(f"{entry['id']}: thumbnail does not exist: {thumbnail['src']}")
        source = template.get("source")
        if not isinstance(source, dict) or not source.get("title") or not source.get("promptUsage"):
            raise SystemExit(f"{entry['id']}: complete source metadata is required")
        slug = entry["id"]
        if slug in seen_slugs:
            raise SystemExit(f"duplicate official prompt slug: {slug}")
        seen_slugs.add(slug)
        content_hash = digest(template)
        search_parts = [entry["title"], entry["description"], discovery["userPromise"], *aliases,
                        *intents, *input_modes, *subject_kinds, *output_kinds, *preservation,
                        *entry.get("capabilities", [])]
        records.append({
            "source": "official",
            "id": entry["id"],
            "slug": slug,
            "version": template["version"],
            "hash": content_hash,
            "title": entry["title"],
            "description": entry["description"],
            "userPromise": discovery["userPromise"],
            "collection": discovery["collection"],
            "category": entry["category"],
            "family": entry["family"],
            "defaultOperation": template["generation"]["defaultOperation"],
            "intents": intents,
            "inputModes": input_modes,
            "subjectKinds": subject_kinds,
            "outputKinds": output_kinds,
            "preservationNeeds": preservation,
            "inputMode": input_modes[0],
            "outputKind": output_kinds[0],
            "complexity": discovery["complexity"],
            "requiredInputs": required_inputs,
            "preserves": preservation,
            "badges": badges,
            "aliases": aliases,
            "capabilities": entry.get("capabilities", []),
            "searchText": " ".join(search_parts),
            "thumbnail": thumbnail,
            "featuredRank": discovery.get("featuredRank"),
            "facets": {
                "intent": intents,
                "input-mode": input_modes,
                "subject-kind": subject_kinds,
                "output-kind": output_kinds,
                "preservation-need": preservation,
                "capability": entry.get("capabilities", []),
                "collection": [discovery["collection"]],
            },
            "template": template,
            "templateSchema": template["schema"],
            "sourceMetadata": source,
        })
    if not records:
        raise SystemExit("No templates contain complete official discovery metadata")
    return sorted(records, key=lambda item: item["id"])


def validate_lock(records: list[dict[str, Any]], update: bool) -> dict[str, str]:
    existing = json.loads(VERSION_LOCK.read_text(encoding="utf-8")) if VERSION_LOCK.exists() else {}
    proposed = dict(existing)
    for record in records:
        key = f"{record['id']}@{record['version']}"
        prior_versions = [int(item.rsplit("@", 1)[1]) for item in existing if item.startswith(f"{record['id']}@")]
        if prior_versions and record["version"] < max(prior_versions):
            raise SystemExit(f"{record['id']}: current official version regressed")
        if key in existing and existing[key] != record["hash"]:
            raise SystemExit(f"{key}: immutable official version content changed; increment the template version")
        proposed[key] = record["hash"]
    if update:
        VERSION_LOCK.parent.mkdir(parents=True, exist_ok=True)
        VERSION_LOCK.write_text(pretty(proposed), encoding="utf-8")
    elif proposed != existing:
        raise SystemExit("Official version lock is stale; run npm run catalog:build and review the result")
    return proposed


def validate_seed(records: list[dict[str, Any]], sql_output: str) -> None:
    database = sqlite3.connect(":memory:")
    try:
        database.executescript((ROOT / "migrations" / "0001_official_prompt_library.sql").read_text(encoding="utf-8"))
        database.executescript(sql_output)
        database.executescript(sql_output)
        counts = database.execute(
            "SELECT (SELECT count(*) FROM official_prompts), "
            "(SELECT count(*) FROM official_prompt_versions), "
            "(SELECT count(*) FROM official_prompt_fts)"
        ).fetchone()
        expected = len(records)
        if counts != (expected, expected, expected):
            raise SystemExit(f"D1 seed is not idempotent: expected {(expected, expected, expected)}, got {counts}")
        version_mismatches = database.execute(
            "SELECT count(*) FROM official_prompts p LEFT JOIN official_prompt_versions v "
            "ON v.prompt_id=p.id AND v.version=p.current_version WHERE v.prompt_id IS NULL"
        ).fetchone()[0]
        if version_mismatches:
            raise SystemExit("One or more current official prompt versions do not exist")
        validate_search_evaluations(database)
    finally:
        database.close()


def to_fts_query(query: str) -> str:
    tokens = re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", query).lower(), flags=re.UNICODE)[:16]
    return " OR ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens)


def validate_search_evaluations(database: sqlite3.Connection) -> None:
    payload = yaml.safe_load(SEARCH_EVALUATIONS.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else None
    if not isinstance(cases, list) or not cases:
        raise SystemExit("Official search evaluations require at least one case")
    allowed_facets = {"intent", "input-mode", "subject-kind", "output-kind", "preservation-need", "collection", "capability"}
    for case in cases:
        if not isinstance(case, dict) or not all(isinstance(case.get(key), str) for key in ("name", "query", "expectedFirst")):
            raise SystemExit("Every official search evaluation requires name, query, and expectedFirst")
        fts_query = to_fts_query(case["query"])
        if not fts_query:
            raise SystemExit(f"{case['name']}: search query has no searchable tokens")
        clauses = ["p.active = 1", "official_prompt_fts MATCH ?"]
        values: list[str] = [fts_query]
        facets = case.get("facets", {})
        if not isinstance(facets, dict) or any(key not in allowed_facets for key in facets):
            raise SystemExit(f"{case['name']}: search evaluation contains an unsupported facet")
        for facet_type, facet_values in facets.items():
            if not isinstance(facet_values, list) or not facet_values or any(not isinstance(value, str) for value in facet_values):
                raise SystemExit(f"{case['name']}: facet {facet_type} requires string values")
            slots = ", ".join("?" for _ in facet_values)
            clauses.append(
                "EXISTS (SELECT 1 FROM official_prompt_facets sf WHERE sf.prompt_id=p.id "
                f"AND sf.facet_type=? AND sf.facet_value IN ({slots}))"
            )
            values.extend([facet_type, *facet_values])
        rows = database.execute(
            "SELECT p.id FROM official_prompts p JOIN official_prompt_fts f ON f.prompt_id=p.id "
            f"WHERE {' AND '.join(clauses)} "
            "ORDER BY bm25(official_prompt_fts, 0, 8, 3, 6, 1, 1), "
            "p.featured_rank IS NULL, p.featured_rank, p.title LIMIT 8",
            values,
        ).fetchall()
        ranked = [row[0] for row in rows]
        if not ranked or ranked[0] != case["expectedFirst"]:
            raise SystemExit(f"{case['name']}: expected {case['expectedFirst']} first, got {ranked}")


def seed_sql(records: list[dict[str, Any]], build_hash: str) -> str:
    catalog_version = f"catalog-{build_hash.removeprefix('sha256:')[:16]}"
    published_at = "2026-09-03T00:00:00Z"
    lines = ["-- Generated by scripts/build_official_catalog.py. Do not edit.", "BEGIN TRANSACTION;"]
    for record in records:
        values = [record[key] for key in ("id", "slug", "version", "title", "description", "userPromise",
            "collection", "category", "family", "defaultOperation", "inputMode", "outputKind", "complexity")]
        values.extend([canonical(record["requiredInputs"]), canonical(record["preserves"]), canonical(record["badges"]),
            canonical(record["aliases"]), record["searchText"], record["thumbnail"]["src"], record["thumbnail"]["alt"],
            record["featuredRank"], 1, published_at, published_at])
        lines.append("INSERT INTO official_prompts (id, slug, current_version, title, short_description, user_promise, collection, category, template_family, default_operation, input_mode, output_kind, complexity, required_input_summary, preservation_summary, badges, aliases, search_text, thumbnail_path, thumbnail_alt, featured_rank, active, created_at, updated_at) VALUES (" + ", ".join(sql(value) for value in values) + ") ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, current_version=excluded.current_version, title=excluded.title, short_description=excluded.short_description, user_promise=excluded.user_promise, collection=excluded.collection, category=excluded.category, template_family=excluded.template_family, default_operation=excluded.default_operation, input_mode=excluded.input_mode, output_kind=excluded.output_kind, complexity=excluded.complexity, required_input_summary=excluded.required_input_summary, preservation_summary=excluded.preservation_summary, badges=excluded.badges, aliases=excluded.aliases, search_text=excluded.search_text, thumbnail_path=excluded.thumbnail_path, thumbnail_alt=excluded.thumbnail_alt, featured_rank=excluded.featured_rank, active=1, updated_at=excluded.updated_at;")
        lines.append("INSERT OR IGNORE INTO official_prompt_versions (prompt_id, version, template_json, template_schema, content_hash, normalized_prompt, negative_prompt, source_json, change_note, created_at, published_at) VALUES (" + ", ".join(sql(value) for value in [record["id"], record["version"], canonical(record["template"]), record["templateSchema"], record["hash"], record["template"]["prompt"]["body"], record["template"]["prompt"].get("negativePrompt"), canonical(record["sourceMetadata"]), "Initial official catalog publication.", published_at, published_at]) + ");")
    ids = ", ".join(sql(record["id"]) for record in records)
    lines.extend([f"DELETE FROM official_prompt_facets WHERE prompt_id IN ({ids});", "DELETE FROM official_prompt_fts;"])
    for record in records:
        for facet_type, values in sorted(record["facets"].items()):
            for value in sorted(set(values)):
                lines.append("INSERT INTO official_prompt_facets (prompt_id, facet_type, facet_value) VALUES (" + ", ".join(map(sql, [record["id"], facet_type, value])) + ");")
        lines.append("INSERT INTO official_prompt_fts (prompt_id, title, description, user_promise, aliases, search_text) VALUES (" + ", ".join(map(sql, [record["id"], record["title"], record["description"], record["userPromise"], " ".join(record["aliases"]), record["searchText"]])) + ");")
    lines.append("INSERT INTO official_prompt_catalog_meta (singleton, catalog_version, build_hash, published_at) VALUES (1, " + ", ".join(map(sql, [catalog_version, build_hash, published_at])) + ") ON CONFLICT(singleton) DO UPDATE SET catalog_version=excluded.catalog_version, build_hash=excluded.build_hash, published_at=excluded.published_at;")
    lines.extend(["COMMIT;", ""])
    return "\n".join(lines)


def drizzle_seed_path(build_hash: str, check: bool) -> Path:
    hash_prefix = build_hash.removeprefix("sha256:")[:16]
    migrations: list[tuple[int, str, Path]] = []
    if DRIZZLE_DIR.exists():
        for path in DRIZZLE_DIR.glob("*_seed_*.sql"):
            match = re.fullmatch(r"(\d{4})_seed_([0-9a-f]{16})\.sql", path.name)
            if match:
                migrations.append((int(match.group(1)), match.group(2), path))
    matching = [path for _, digest_prefix, path in migrations if digest_prefix == hash_prefix]
    if matching:
        return matching[0]
    if check:
        raise SystemExit("Sites D1 catalog seed migration is stale")
    next_number = max([number for number, _, _ in migrations] + [1]) + 1
    return DRIZZLE_DIR / f"{next_number:04d}_seed_{hash_prefix}.sql"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    records = load_records()
    public_records = [{key: value for key, value in record.items() if key not in {"template", "sourceMetadata", "searchText", "facets"}} for record in records]
    build_hash = digest(public_records)
    output = {"schema": "prompt-canvas.official-catalog@1", "buildHash": build_hash, "count": len(records), "prompts": public_records}
    sql_output = seed_sql(records, build_hash)
    migration_output = (ROOT / "migrations" / "0001_official_prompt_library.sql").read_text(encoding="utf-8")
    drizzle_seed = drizzle_seed_path(build_hash, args.check)
    validate_seed(records, sql_output)
    validate_lock(records, update=not args.check)
    if args.check:
        if not OUT_MANIFEST.exists() or OUT_MANIFEST.read_text(encoding="utf-8") != pretty(output):
            raise SystemExit("Generated official catalog is stale")
        if not OUT_SEED.exists() or OUT_SEED.read_text(encoding="utf-8") != sql_output:
            raise SystemExit("Generated official D1 seed is stale")
        if not DRIZZLE_SCHEMA.exists() or DRIZZLE_SCHEMA.read_text(encoding="utf-8") != migration_output:
            raise SystemExit("Sites D1 schema migration is stale")
        if not drizzle_seed.exists() or drizzle_seed.read_text(encoding="utf-8") != sql_output:
            raise SystemExit("Sites D1 catalog seed migration is stale")
    else:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        DRIZZLE_DIR.mkdir(parents=True, exist_ok=True)
        OUT_MANIFEST.write_text(pretty(output), encoding="utf-8")
        OUT_SEED.write_text(sql_output, encoding="utf-8")
        DRIZZLE_SCHEMA.write_text(migration_output, encoding="utf-8")
        drizzle_seed.write_text(sql_output, encoding="utf-8")
    print(f"Validated {len(records)} official recipes ({build_hash})")


if __name__ == "__main__":
    main()
