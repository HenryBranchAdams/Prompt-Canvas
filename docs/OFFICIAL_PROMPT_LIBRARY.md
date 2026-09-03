# Official Prompt Library

The Official Prompt Library is Prompt Canvas's owner-controlled, read-only recipe catalog. It makes a larger curated
library retrievable without loading every complete prompt into the page or an agent's context. It does not replace the
local recipe library and it does not grant the page image-generation authority.

## Authority and storage boundary

- Official recipes are original Prompt Canvas YAML files reviewed in this repository.
- D1 contains only published official summaries, facets, and immutable recipe versions.
- Recipes a person creates or saves remain in local IndexedDB on that device. They are never uploaded or indexed.
- The public service has no recipe create, update, delete, submission, moderation, rating, creator-account, or community
  endpoints.
- Search uses SQLite FTS5 and explicit facets. There is no embedding service or vector store.
- Codex remains responsible for generation, editing, variations, and upscaling. The page only resolves context and
  validates returned assets.

## Read-only routes

| Route | Purpose |
| --- | --- |
| `GET /api/official-library/catalog` | Compact current catalog and catalog build identity |
| `POST /api/official-library/search` | Bounded FTS5 and facet retrieval, default 8 and maximum 20 candidates |
| `GET /api/official-library/prompts/:id` | Current immutable version |
| `GET /api/official-library/prompts/:id/versions/:version` | Exact immutable version |

Unknown fields, oversized bodies, invalid facets, invalid IDs, and unsupported methods fail closed with stable error
responses. Queries use prepared bindings; user text is normalized into at most 16 quoted prefix tokens.

## Agent retrieval loop

1. Call `prompt_canvas_list_templates` with `scope: official`, a short ordinary-language query, and only useful facets.
2. Compare the compact candidate summaries and choose one recipe.
3. Call `prompt_canvas_get_template` with `source: official`, its exact id, version, and expected hash.
4. Create the project with the same official source identity.
5. Inspect readiness and resolve generation context before asking Codex to generate one candidate.
6. Return that image through `prompt_canvas_add_generated_asset` and verify request and output-slot lineage.

Complete prompt bodies are not included in catalog or search responses. Exact version content is fetched only after a
candidate is selected.

## Repository publishing

Each official template must contain complete `x-discovery` metadata, first-party source metadata, and an owned
thumbnail under `public/recipe-thumbnails/`. Publish a content change as a new positive template version; a released
`id@version` is immutable.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm install
npm run catalog:build
npm run catalog:validate
npm run catalog:seed:local
npm run check
npm run test:e2e
```

`catalog:build` validates the template schema and discovery metadata, verifies thumbnail presence, updates the version
lock, generates compact JSON and an idempotent SQL seed, copies the schema migration, and creates ordered hash-named
Sites seed chunks capped at 20 KB. Deployment chunks intentionally omit SQL transaction statements because the Sites
migration runner supplies its own storage transaction. Seed data is accumulated in deployment-only staging tables; the
last migration atomically publishes the complete catalog and removes staging, so a failed earlier chunk cannot expose a
mixed catalog. The builder applies both the monolithic local seed and the exact deployment chunks twice to in-memory SQLite
databases, checks version integrity, and runs the ordinary-language retrieval cases in
`official-library/search-evaluations.yaml` against actual FTS5 ranking.

Review the source YAML, thumbnail, version-lock delta, catalog JSON, and hash-named migration together. Deployment then
applies the checked-in files under `drizzle/` to the Site's `DB` binding. Never hand-edit generated catalog or seed files.

## Availability and recovery

If D1 is missing, slow, malformed, or unavailable, the worker returns an honest unavailable response and the client
uses its last-known-good summary cache or bundled official catalog. Exact template reads also verify SHA-256 and can use
the identical bundled official version. This preserves first-run and project creation without treating a network failure
as an empty official library.

The public `.openai/hosting.json` contains a placeholder project id so a clone cannot target the production Site. A
Site owner supplies the real project identity only in the private deployment source. No secrets or database credentials
belong in source files, migrations, browser storage, or route responses.

## Independent first-party collection

The catalog includes 42 fresh Prompt Canvas recipes that cover a reviewed inventory of creative jobs. Their titles,
prompt expression, controls, preservation rules, discovery metadata, and canvas composition were authored independently
for this project. The external research corpus itself is not copied, bundled, migrated, or distributed, and no
third-party prompt text or assets are required at runtime. Each recipe has a dedicated, owned first-party SVG preview.
