# Official Prompt Library

The Official Prompt Library is Prompt Canvas's owner-reviewed, read-only recipe catalog. It makes a larger curated
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
lock, generates compact JSON and an idempotent SQL seed, copies the schema migration, and creates a hash-named Sites
seed migration. The builder applies the schema and seed twice to an in-memory SQLite database, checks version integrity,
and runs the ordinary-language retrieval cases in `official-library/search-evaluations.yaml` against actual FTS5 ranking.

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

## Deferred intake

A separate 42-system `chatgpt-image-original-library.md` corpus was reviewed for this release. Its own documentation
describes the material as rewritten from public third-party prompting techniques, while the parent index says prompts
remain third-party content and should be reused according to the original authors' intent. It also has no qualified
first-party recipe thumbnails. Those 42 candidates are therefore not copied into the MIT source tree, D1 seed, bundled
fallback, or deployed catalog. They may be admitted later only with a documented redistribution basis or after fresh,
independently authored Prompt Canvas recipes and owned thumbnails pass the same review gates.
