# Prompt Canvas agent guide

Prompt Canvas is one semantic system shared by the person, Codex, WebMCP, and durable tldraw state. Preserve the stable
public tool names, revision safety, request and output-slot lineage, manual geometry, undo behavior, and local durability.

For official recipe selection, retrieve compact candidates first with `prompt_canvas_list_templates` using
`scope: official`. Fetch only the selected exact id, version, and hash with `prompt_canvas_get_template`, then create the
project with that same source identity. Inspect readiness and resolve generation context before one bounded native Codex
generation. Return the validated image to its intended slot and confirm lineage.

Treat the open Site as a shared workspace, not a passive prompt form. When the user asks for help shaping a project,
inspect the active project, ask at most two focused questions only when genuinely needed, then update the visible brief or
direction through the existing workspace tools. Do not generate until the user asks. When they do ask, use the newest live
project state and return the result to the prepared output rather than explaining the tool sequence.

Official recipes are repository-authored, owner-reviewed, first-party material published read-only through D1. User
recipes stay local in IndexedDB. Do not add public writes, community submission flows, embeddings, accounts, a page-owned
image model, or a duplicate chat surface. D1 connections and canvas arrows are retrieval and presentation aids, not an
executable workflow engine.

Before publishing an official recipe change, increment its version, run `npm run catalog:build`, review the version lock
and generated seed migration, then run `npm run check` and `npm run test:e2e`. Do not change a released `id@version`.
