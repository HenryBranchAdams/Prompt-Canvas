# Prompt Canvas release validation

This file defines the evidence required for the public release. Exact run identifiers, commit SHA, Site version, and
host build are recorded in the immutable GitHub release and Sites deployment records for the released commit.

## Required gates

- `npm run check`
- `npm run test:e2e`
- fixed-base standards and specification review
- exact-head continuous integration
- production bundle packaging
- public live-origin smoke test
- one bounded Codex-host image return using the release Site

Browser mocks prove page behavior only. They do not qualify native Codex generation or a desktop-host transport. A
release is accepted only when its external records identify the same source commit deployed to the public Site.

## Local candidate evidence — 2026-09-03

- `npm run check`: passed; 19 recipes and eleven tool schemas, zero validation errors or compatibility warnings,
  81/81 deterministic tests, TypeScript, lint with zero errors and nine existing Fast Refresh warnings, and the
  production build.
- `npm run test:e2e`: 21/21 Chromium tests passed, including recipe-first entry, first-party thumbnail loading,
  ordinary-language recipe search, directly interactive canvas controls, modular workflow geometry, transient WebMCP
  retry without duplicate successful registrations, official D1 retrieval, exact source lineage, local-only custom
  recipe saving, generated-asset lineage, stale requests, undo/redo, manual geometry, and reload durability.
- Deterministic catalog validation: ten official recipes, ten immutable versions, and ten FTS5 rows at
  `catalog-c793fa82ebe18c59` / `sha256:c793fa82ebe18c59fef155107c96a318912cba9854495665a70437e0b8e03e50`.
  The generated seed was applied to local D1 and all seven ordinary-language top-result evaluations passed against
  SQLite FTS5.
- `npm audit --json`: zero vulnerabilities across 417 dependency records.
- Visual QA: the recipe-first gallery, connected starter canvas, and simplified Codex handoff were captured at
  1600 × 1000, compared side by side with both selected design targets, and passed with no broken assets or console/page
  errors. The private release record retains the comparison artifacts without publishing local filesystem paths.
- `git diff --check`: passed.

These results are local evidence. Exact-head CI, deployment, public access, and real-host image return remain separate
external gates attached to the released commit.

## Public-source boundary

The public starter pack contains 19 first-party original recipes. Ten outcome-first recipes form the official D1
catalog and use owned preview images; nine advanced creative systems remain bundled locally. Adapted prompt expression,
including the 42 rewritten third-party-derived systems in the external image-prompt index, unresolved third-party
research material, historical generated-output fixtures, and their source-specific qualification notes are excluded.
The source index remains a deferred intake set pending clear redistribution rights or independently authored
first-party replacements.
