# Licensing and public-release boundary

Prompt Canvas uses the MIT License for original project software and first-party original template content. The public release tree contains only that project material plus third-party dependency metadata.

This document records the intended scope of the project license. It is a release-governance statement, not a representation that Prompt Canvas owns or can relicense every referenced third-party work.

## MIT-licensed project material

The root `LICENSE` applies to original Prompt Canvas material owned by the project, including:

- application and worker source code;
- tests, scripts, configuration, schemas, and original project documentation;
- first-party templates whose source metadata identifies `promptUsage: original`, including templates authored by Prompt Canvas or supplied by Henry Adams for this project; and
- the six original first-party recipe-preview images under `public/recipe-thumbnails/`; and
- original modifications to project-owned code and first-party templates.

Copyright remains with the named copyright holder and contributors as applicable.

## Material not relicensed by Prompt Canvas

The MIT grant does not create rights in material the project does not own. In particular, it does not grant rights to:

- third-party libraries or generated dependency contents, which retain their own licenses;
- third-party trademarks, logos, names, photographs, screenshots, or reference assets;
- source posts, prompt text, or other expression merely linked or summarized in provenance metadata; or
- externally adapted template material identified by source metadata such as `promptUsage: adapted`, except to the extent the project has an independent right to license its own original contribution.

Attribution and public availability are not substitutes for permission or an applicable license.

## Current recipe-library boundary

The bundled 15-recipe library and its six first-party preview images are covered by the project MIT license. Adapted templates and
their source research were deliberately excluded from this release tree. They may remain in non-public Git history for
development provenance, but are not shipped by the application or included in the clean public-source snapshot.

## Visibility and publication decisions

Choosing or merging a source-code license does not itself change access. Repository visibility, Site visibility, and starter-pack distribution remain separate release controls.

- A public repository does not make the deployed Site public.
- A public Site does not make the repository public, but it can still expose templates or other material delivered by the build.
- A public starter pack is a separate distribution even when its source repository or Site remains private.

The September 2026 release was explicitly authorized for public source and public Site access after the adapted-template exclusions above.

## Contributions

Contributions to original project code and first-party project content are accepted under the project MIT License unless a separate written agreement or file-level notice says otherwise. Contributors must not submit third-party material they lack the right to contribute.

## Trademarks and hosted services

The license does not grant rights to OpenAI, ChatGPT, Codex, tldraw, or other third-party names or marks. It also does not grant access to hosted services, API entitlements, model usage, deployment environments, or commercial licenses required by dependencies.
