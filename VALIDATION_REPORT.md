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

## Original 42-recipe collection candidate — 2026-09-03

- `npm run check`: passed; 61 recipes and eleven tool schemas, zero validation errors or compatibility warnings,
  81/81 deterministic tests, TypeScript, lint with zero errors and nine existing Fast Refresh warnings, and the
  production build.
- Full Chromium suite: 21/21 passed on an isolated local port because the default 4173 port was already serving an
  unrelated local application. The first attempt correctly failed against that unrelated server; it was not a product
  regression.
- Deterministic catalog validation: 52 official recipes at
  `sha256:e48c2d7967653846c7c97892954421d9ad8476444ff2d42c1c9737a329a6385a`, with 15 ordinary-language
  top-result evaluations passing against SQLite FTS5. The generated monolithic seed and 32 staged Sites migration
  chunks both passed idempotency and atomic-publication validation.
- Independent-expression audit: all 42 new prompt bodies were compared with the fenced prompt examples in the
  external intake corpus. No shared eight-word sequence was found; the highest normalized sequence similarity was
  0.114.
- `npm audit --json`: zero vulnerabilities across 417 dependency records.
- `git diff --check`: passed, and the public tree contains no source-corpus path, author handle, copied research text,
  adapted template metadata, private image bytes, or third-party assets.

These are candidate-branch results. CI, D1 migration, deployment, and native-host generation remain separate gates and
must not be inferred from the local checks.

## Public-source boundary

The public starter pack contains 61 first-party original recipes. Fifty-two recipes form the official D1 catalog and
use owned first-party preview assets; nine advanced creative systems remain bundled locally. The 42 task-focused
systems are independently authored replacements based only on a high-level inventory of creative jobs. Adapted prompt
expression, the external image-prompt corpus itself, unresolved third-party research material, historical generated-output
fixtures, and source-specific qualification notes remain excluded.
