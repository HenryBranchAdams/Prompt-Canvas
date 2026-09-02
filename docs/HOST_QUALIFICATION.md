# Codex host qualification

Local checks and browser automation do not establish that a Codex host exposes WebMCP tools or can return generated
image bytes. Each public release must run one bounded acceptance flow against the exact deployed Site revision.

## Release acceptance flow

1. Record the public Site URL, Sites version, source commit, desktop product/version/build, and visible tool inventory.
2. Inspect the active workspace and record its workspace ID and revision.
3. Apply one harmless semantic control mutation with `expectedRevision`.
4. Replay the old revision and confirm rejection without partial mutation.
5. Prepare one generation context and record request ID, generation revision, prompt digest, operation, and output slot.
6. Generate one candidate with Codex and return it through `prompt_canvas_add_generated_asset`.
7. Confirm visible placement and exact request, digest, slot, MIME, byte, and provider lineage.
8. Promote or compare the returned output, then verify undo, redo, and reload persistence.

Only transports and MIME types observed in this flow may be advertised. Configured limits are not measured host maxima.
Do not record private image bytes, credentials, environment values, or owner-only access tokens in public evidence.

## Historical evidence

A prior private deployment on Sites version 14 established a PNG `data_url` round trip in ChatGPT/Codex desktop
`26.825.41651` build `7345`. That observation remains useful historical evidence but does not qualify a later public
Site version or a different host build.
