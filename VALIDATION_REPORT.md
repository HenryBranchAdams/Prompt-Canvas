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

## Local candidate evidence — 2026-09-02

- `npm run check`: passed; nine templates and eleven tool schemas, zero validation errors or compatibility warnings,
  66/66 deterministic tests, TypeScript, lint with zero errors and nine existing Fast Refresh warnings, and the
  production build.
- `npm run test:e2e`: 17/17 Chromium tests passed, including transient WebMCP retry without duplicate successful
  registrations, modal focus containment, generated-asset lineage, stale requests, undo/redo, manual geometry, and
  reload durability.
- `npm audit --json`: zero vulnerabilities across 417 dependency records.
- In-app browser QA: Prompt Canvas rendered with all eleven WebMCP tools, the nine-template library, visible Travel
  Poster workspace, Escape close, focus restoration, and no framework error overlay.
- `git diff --check`: passed.

These results are local evidence. Exact-head CI, deployment, public access, and real-host image return remain separate
external gates attached to the released commit.

## Public-source boundary

The public starter pack contains nine first-party original templates. Adapted prompt expression, unresolved third-party
research material, historical generated-output fixtures, and their source-specific qualification notes are excluded.
The private development repository retains that history.
