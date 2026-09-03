# Prompt Canvas v0.4.0

This competition release keeps Prompt Canvas's semantic engine intact while making its first-run and showcase canvas
experience calmer, clearer, and easier to understand.

## Highlights

- Travel Poster now opens as five coherent surfaces with four quiet workflow connections and a dominant result.
- Create from Words and Change the Background use grouped inputs, a large hero result, and a directly adjacent
  variations surface; the raw model prompt stays available through technical details rather than dominating the canvas.
- The recipe gallery keeps quick starts prominent, initially shows eight long-tail official recipes, and reveals all
  matching recipes during ordinary-language search.
- All eleven Website Tools retain their public names and schemas, with clearer recipe/project language, side effects,
  exact source-identity requirements, revision safety, and the Codex generation boundary.
- Canvas cards use quiet grip affordances, larger readable controls, a softer grid, subdued connectors, and visible
  color-palette controls.
- The public source contains 61 first-party bundled recipes, including 52 owner-curated official D1 recipes. User-saved
  recipes remain local to IndexedDB.

## Compatibility

- `create-from-words` advances to version 2.
- `change-background` advances to version 2.
- `travel-poster` advances to version 3.
- Existing projects retain their immutable recipe snapshots and manual geometry.
- The original ten Website Tool names remain stable; guarded project deletion remains the eleventh additive tool.

## Boundaries

Codex remains the image-generation host. The page prepares revision-bound generation context and validates returned
assets; it does not call an image model or require an OpenAI API key. Community publishing, user accounts, embeddings,
server storage for local recipes, and the deferred agent-control-plane roadmap are not part of this release.
