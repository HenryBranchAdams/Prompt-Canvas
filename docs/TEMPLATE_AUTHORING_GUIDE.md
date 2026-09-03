# Prompt Canvas Template Authoring Guide

## Purpose

This guide is for people and agents creating new Prompt Canvas templates.

A template is a portable semantic description of an image-generation workspace. It tells the app and Codex what the creative task is, what inputs matter, what must be preserved, which options deserve direct controls, and where outputs belong. It is **not** a frozen screen layout and it is not an executable program.

The authoring goal is:

> Preserve open-ended creative direction while exposing just enough structure to make a prompt reusable, inspectable, and easy to iterate.

The machine-readable contract is `schemas/prompt-workspace-template.schema.json`.

The canonical agent operating model is [`AGENT_SYSTEM.md`](AGENT_SYSTEM.md). A template participates in that system by making creative intent, authority, readiness, evaluation, and reusable evidence legible without turning the template into an executable workflow engine.


---

## 1. The three-layer standard

### Layer 1 — hard compatibility core

Only this layer can block a template.

A template author must provide:

- `id`
- `version`
- `title`
- `description`
- `generation.operations`
- `prompt.body`
- at least one `outputs` entry with `id`, `label`, `role`, and `kind`

Author input may omit the constant `schema`, `generation.provider`, `generation.capability`, and `generation.delivery` boilerplate. Validation restores those constants before persistence, so persisted and returned templates remain explicit. Author input must also be code-free, bounded, and valid JSON/YAML data.

### Layer 2 — compatibility lint

Lint finds likely integration mistakes but does not block creativity. Examples:

- a variable never appears in the prompt;
- a control points to a missing variable;
- an edit template has no reference slot;
- an output advertises an operation the generation configuration does not support;
- a template requires references but does not explain what they control;
- a template defines many controls that repeat the prompt rather than create leverage.

Warnings should be fixable or explicitly dismissible.

### Layer 3 — creative review

Creative review is advisory. It may ask:

- Is the focal idea clear?
- Which details are essential versus decorative?
- Are the negative constraints concrete?
- Does a reference-image edit clearly state what stays fixed?
- Would one control replace repeated prompt editing?
- Is the layout hint serving the process or merely imitating another template?

Creative review must never enforce one art style, one prompt length, or the Travel Poster layout.

---

## 2. The minimum useful template

A valid template can be intentionally small. The explicit form below shows the normalized representation; authors may omit the constant schema/provider/capability/delivery fields:

```yaml
schema: prompt-canvas.prompt-workspace-template@2
id: loose-ink-study
version: 1
title: Loose Ink Study
description: Turn any subject into a sparse hand-drawn ink study.
generation:
  provider: codex
  capability: image-generation
  delivery: webmcp-import
  operations: [generate]
prompt:
  body: >-
    Create a loose ink study of {{subject}} with broad directional marks,
    broken contours, and generous untouched paper.
outputs:
  - id: primary
    label: Primary image
    role: primary
    kind: image
    count: 1
```

The app can synthesize a prompt block, a default output region, and an optional variable control. Nothing else is mandatory.

---

## 3. Choose a family, but do not become trapped by it

`compatibility.templateFamily` helps discovery and default layout selection.

### Lightweight

Use when the creative instruction is already compact and only one or two choices change frequently.

Good examples:

- Loose Watercolor Drift
- Contemporary Screenprint
- Documentary Film Photography

Do not expand a concise prompt into a twenty-field form.

### Parameterized

Use when explicit substitutions make a prompt genuinely reusable.

Good examples:

- city
- country
- product
- subject
- palette
- aspect ratio

The original freeform prompt remains first-class. Variables are interpolation points, not a replacement for prose.

### Reference transformation

Use when an uploaded image defines identity, geometry, composition, or material facts.

Declare:

- the reference role;
- whether it is required;
- what it controls;
- what must remain unchanged;
- which edit operations are supported.

Good examples:

- Fashion Illustration Collage
- Anime Stamp Window
- Pseudo-3D Icon Redesign
- Charcoal Memory Study

### Multi-reference

Use when different images play different roles.

Prefer separate slots such as:

- content reference
- identity reference
- composition reference
- style reference
- palette reference
- material reference
- mask

Do not present an unlabeled pile of images and expect Codex to infer the hierarchy.

### Composition-first

Use when spatial organization is a core creative input.

Composition may be represented by:

- written hierarchy;
- a layout reference image;
- named regions;
- focal and secondary roles;
- directional flow;
- negative-space constraints;
- typography zones.

A composition-first template should not require a fixed coordinate grid.

### Multi-stage

Use when the task genuinely has dependent decisions, such as:

1. gather a brief;
2. recommend directions;
3. select a direction;
4. create a structured treatment;
5. generate;
6. review and refine.

Workflow stages are semantic guidance for Codex and the canvas UI. They are not executable scripts.

### Open

Use `open` when a template intentionally mixes patterns or introduces a new grammar.

---

## 4. Start from the creative nucleus

Before adding schema fields, write one paragraph that answers:

1. What is being created?
2. What makes this result distinct?
3. What is the primary visual relationship or transformation?
4. What facts or identity must be preserved?
5. What are the most common failure modes?

This is the creative nucleus. Preserve it in `prompt.body` even after adding variables or controls.

A template should remain understandable when every control is ignored and the prompt is read alone.

---

## 5. Variables

Create a variable when users will repeatedly substitute one concept without changing the rest of the prompt.

Useful variables include:

- `subject`
- `city_name`
- `destination`
- `product_name`
- `tagline`
- `accent_color`
- `aspect_ratio`
- `scene`

Avoid variables for every adjective. A prompt such as “quiet, airy, editorial” usually does not need three separate variables unless users will actively compare those dimensions.

### Variable checklist

- Is the variable referenced in the prompt or workflow?
- Does its label make sense outside the original example?
- Is a default value illustrative rather than restrictive?
- Can freeform input remain available where the option space is open?
- Does an enum represent a real finite choice, or should it be a combobox with custom input?

---

## 6. Controls

A control is worthwhile when it lets a person make a high-leverage decision without rewriting prose.

### Good control candidates

- aspect ratio
- output count
- one selected composition direction
- palette
- subject or destination
- reference strength
- fidelity versus novelty
- number of figures
- detail density
- typography presence
- material treatment

### Poor control candidates

- every descriptive word in the prompt;
- internal model jargon the user does not need;
- values that should be inferred from the subject;
- controls that all default to “maximum” and never get changed;
- dozens of toggles that recreate the prompt sentence by sentence.

### Open-ended choices

Use `combobox` with `allowCustom: true` when presets are helpful but cannot cover the domain.

### Bindings

Controls may bind to:

- a variable;
- a prompt fragment;
- the negative prompt;
- a generation field;
- a workflow decision;
- preservation guidance;
- general agent context.

An `agent-context` binding is valid when a value should remain structured for Codex but should not be mechanically interpolated into one brittle string.

---

## 7. References

A reference slot should answer two questions:

1. What role does this asset play?
2. What must Codex preserve or extract from it?

Supported roles include:

- `content`
- `identity`
- `composition`
- `style`
- `palette`
- `material`
- `mask`
- `source-photo`
- `logo`
- `other`

### Example

```yaml
references:
  - id: source-photo
    label: Source photograph
    role: identity
    required: true
    multiple: false
    acceptedMimeTypes: [image/jpeg, image/png, image/webp]
    preserve:
      - subject identity
      - pose
      - camera viewpoint
      - spatial relationships
```

For multiple references, define separate slots whenever their authority differs.

---

## 8. Preservation rules

Preservation rules are especially important for image editing.

### `must`

Use for identity or structural requirements whose violation makes the output wrong:

- same person
- same number of subjects
- same logo silhouette
- same building order
- same camera angle
- same pose
- continuous road or waterline

### `prefer`

Use for continuity that should remain unless the user overrides it:

- lighting atmosphere
- color memory
- framing
- background character

### `may`

Use for details Codex may preserve when useful:

- tiny props
- incidental foliage
- minor surface wear

Do not create hundreds of microscopic rules. Capture the few invariants that define correctness.

---

## 9. Negative prompts and constraints

Negative constraints are most useful when they name a plausible failure mode.

Good:

- no duplicate subject
- do not move the stamp window away from the original subject
- no invented landmark
- no complete charcoal background
- no plastic toy gloss
- do not turn the source photograph into a redraw

Weak:

- no bad quality
- no ugly image
- make it perfect

Keep negative constraints proportionate. A short template should not carry a thousand-word prohibition list unless the transformation genuinely has many structural failure modes.

---

## 10. Outputs

Every template needs at least one output.

Common patterns:

### Primary plus variations

```yaml
outputs:
  - id: primary
    label: Primary image
    role: primary
    kind: image
    count: 1
  - id: variations
    label: Variations
    role: variation
    kind: image-set
    count: 4
```

### Comparison poster

Use one primary output when the photograph and interpretation are composed into one image.

### Intermediate structured context

Multi-stage workflows may produce an intermediate text or structured-context output before image generation.

The app must never interpret an output slot as permission to call an image model itself. Codex performs generation and imports results through WebMCP.

---

## 11. Workflows

Add a workflow only when stages create real value.

Each stage declares:

- `id`
- `title`
- `kind`
- `instructions`
- optional `inputs`
- optional `produces`
- optional `nextStageIds` for explicit routing to existing stages
- whether user choice is required

Supported stage kinds include:

- `collect-input`
- `agent-reasoning`
- `compose-prompt`
- `generate-image`
- `edit-image`
- `select-output`
- `review`
- `custom`

Every `nextStageIds` entry must name another declared stage; unknown workflow references are blocking validation errors. Codex may adapt a workflow unless `allowAgentAdaptation` is false. Even then, the user can directly change canvas content.

---

## 12. Blocks and layout

Blocks are functional surfaces, not pixel-perfect cards.

Examples:

- prompt
- controls
- references
- output
- variations
- notes
- workflow
- comparison
- gallery
- JSON or structured context
- freeform
- custom

Use `region`, `order`, and `layout.arrangement` as hints. The compiler chooses actual dimensions and positions, preserving manual geometry after creation.

Prompt Canvas also recognizes three bounded first-party block extensions when a
template needs a deliberately composed opening canvas:

- `x-controlIds`: render only the named controls in that controls block;
- `x-promptPart`: render `body` or `negative` in that prompt block while keeping
  the complete canonical prompt available to WebMCP and generation context;
- `x-geometry`: seed finite `x`, `y`, `w`, and `h` values at creation time.

These extensions affect only the initial compiled view. They do not change tool
authority, validation, or generation semantics, and later manual geometry remains
authoritative.

A template can omit blocks entirely. The app then builds a default workspace from prompt, controls, references, workflow, and outputs.

---

## 13. Extensions

Unknown `x-*` fields are permitted as inert metadata.

Example:

```yaml
x-research:
  testedSubjects:
    - city street
    - storefront
  knownFailureMode: text may become too dominant
```

Extensions cannot:

- execute code;
- contain active HTML;
- bypass WebMCP schemas;
- write arbitrary tldraw records;
- skip asset validation;
- change the authority of a tool call.

A feature that becomes common should graduate from `x-*` into a documented schema field through a versioned migration.

---


## 13A. Agent legibility contract

A strong template lets an agent understand the task without reverse-engineering hidden dependencies from example prose. In addition to ordinary compatibility, review:

1. **Purpose:** Is the deliverable and intended use clear?
2. **Authority:** Which values are exact user content, supplied facts, template defaults, or open agent discretion?
3. **Readiness:** What inputs or references genuinely block generation?
4. **Preservation:** What makes a returned image correct rather than merely attractive?
5. **Evaluation:** What criteria should be checked after generation?
6. **Economy:** Which choices deserve controls because they avoid repeated prompt rewriting or unnecessary regeneration?
7. **Accretion:** What evidence would justify changing this template in a later version?

The freeform prompt must remain understandable by itself, but optional structure should reduce ambiguity at decision boundaries.

### Optional inert authoring metadata

Until a field graduates into a supported schema contract, bounded `x-agent-*` metadata may describe intent without changing runtime authority:

```yaml
x-agent-authoring:
  purpose: Create a coordinated retail family for design review.
  defaultDiscretion:
    - derive category-appropriate supporting formats
    - choose a quiet studio viewpoint
  generationBlockers:
    - exact supplied copy is required when factuality mode is supplied
  evaluationCriteria:
    - exact approved naming is preserved
    - no unsupported product claims are invented
    - formats share one coherent material and color system
  costGuidance:
    initialCount: 1
    preferTargetedEditAfterFirstCandidate: true
```

Unknown extension data remains inert. It cannot execute, change tool authority, bypass validation, or claim host capability.

## 13B. Default coherence and dependency

Reusable defaults must stay coherent when a primary subject changes.

Choose one of these patterns:

### Neutral instructional defaults

Use directives that remain valid across subjects:

```yaml
defaultValue: derive materials appropriate to the selected product family; do not invent factual claims
```

### Complete named example preset

A named preset may contain a fully coupled set of subject, copy, material, palette, and supporting details. Selecting another preset changes the full bundle.

### Explicitly required dependent fields

When the agent cannot safely derive a value, make the dependency visible and block readiness until supplied.

Avoid the dangerous middle state: one editable primary field plus several silent example-specific defaults. That creates context that is syntactically valid but semantically contradictory.

A multi-subject coherence test should change only the primary field and assert that unrelated example names, characters, components, routes, claims, or conclusions do not survive.

## 13C. Authority-aware references and claims

Reference slots should identify not only role but authority:

- identity references govern named identity traits;
- source photographs govern supplied geometry and scene facts;
- composition references govern hierarchy and flow, not subject matter;
- style references govern shared visual principles, not signatures or unrelated content;
- palette references govern color relationships only;
- user source notes govern supplied claims but do not become independently verified facts.

When several references disagree, the template should state priority or leave an explicit decision point. Do not rely on upload order.

For fact-aware templates, define which text may appear literally, which relationships are supplied, and which details may be conceptual. Evaluation should be able to identify unsupported claims separately from visual defects.

## 13D. Evaluation rubric

A template should make its correctness criteria derivable from:

- purpose and deliverable;
- `must`, `prefer`, and `may` preservation rules;
- exact supplied text;
- reference roles;
- negative constraints;
- factuality mode;
- output slot and operation.

Optional `x-agent-authoring.evaluationCriteria` may add template-specific review guidance while it remains inert metadata.

Do not encode taste as a hard schema rule. Separate:

- deterministic checks, such as exact output count or required reference presence;
- agent visual review, such as hierarchy or continuity;
- human approval, such as aesthetic preference or publication decision.

## 13E. Evidence and accretive evolution

The immutable template definition should not become a growing activity log. Keep qualification and usage evidence in a separate record keyed by template ID and version whenever possible.

A template-evidence record may contain:

- materially different tested subjects;
- deterministic test state;
- native-host qualification state;
- known failure modes;
- counterexamples;
- validated patterns;
- feature decision and authority;
- evidence references.

A change to a default should be justified by repeated evidence, not one attractive output. The promotion path is:

```text
observation
  -> candidate lesson
  -> validation across different subjects
  -> explicit approval
  -> new template version or narrowly scoped preference
```

Preserve failures and counterexamples. Do not silently rewrite an existing immutable starter because later evidence suggests a better default.

## 13F. Resource-aware authoring

Templates should help the agent avoid waste:

- request one initial candidate by default;
- expose a variation count only when exploration is a real workflow need;
- identify what a targeted edit should preserve;
- avoid controls for unsupported model/API parameters;
- do not require generation to answer a question that can be resolved from prompt, references, or preflight;
- separate local layout changes from image regeneration;
- use intermediate structured context only when it materially reduces repeated reasoning.

A complex template may define a Run or workflow plan later, but the template itself remains data and semantic guidance, not executable code.

## 14. Attribution and source handling

The public Prompt Canvas repository accepts first-party original templates by default:

```yaml
source:
  kind: first-party
  title: Original template title
  creator: Prompt Canvas
  promptUsage: original
```

Recommended `promptUsage` values:

- `original`
- `inspiration-only`
- `adapted`
- `verbatim-authorized`

Do not commit adapted expression, raw research, third-party assets, or externally sourced templates to the public
repository without documented redistribution rights. Keep unresolved research outside the public release tree.

Avoid exact living-artist imitation or misleading brand association. Translate references into visual principles such as materials, mark-making, composition, palette, or era.

## Optional fact-aware convention

Fact-aware handling is an **opt-in convention**, not part of the required schema core. Add two ordinary `agent-context` controls only when a workflow needs an explicit boundary between source-backed claims and creative interpretation:

```yaml
controls:
  - id: factuality-mode
    label: Factuality mode
    type: enum
    defaultValue: mixed
    options:
      - { label: Supplied, value: supplied }
      - { label: Conceptual, value: conceptual }
      - { label: Mixed, value: mixed }
    binding:
      mode: agent-context
      target: factuality.mode
  - id: factuality-source-notes
    label: Source notes
    type: textarea
    binding:
      mode: agent-context
      target: factuality.sourceNotes
```

The resolver includes these values as a structured `factuality` object in generation context and in its prompt digest. Source notes are bounded user data, not hidden instructions. A selected mode organizes attribution; it does not verify the notes or prove factual accuracy.

### Minimal fact-aware template

Use `supplied` when the image should stay grounded in a short set of user-supplied assertions. A non-empty `factuality.sourceNotes` value is required; generation fails closed when it is missing. Codex must attribute the assertions as supplied rather than silently treating them as independently verified facts.

```yaml
title: Fact-grounded place card
description: Illustrate a place from supplied notes without adding unsupported claims.
generation:
  provider: codex
  capability: image-generation
  delivery: webmcp-import
  operations: [generate]
prompt:
  body: Create a calm editorial place card using only the supplied place notes for factual claims.
controls:
  - id: factuality-mode
    label: Factuality mode
    type: enum
    defaultValue: supplied
    options: [{ label: Supplied, value: supplied }]
    binding: { mode: agent-context, target: factuality.mode }
  - id: factuality-source-notes
    label: Source notes
    type: textarea
    required: true
    binding: { mode: agent-context, target: factuality.sourceNotes }
outputs:
  - { id: primary, label: Primary image, role: primary, kind: image }
```

### Reference-transformation template

For a source photograph or identity reference, use `mixed` when supplied identity, geometry, or place details must remain distinct from style and composition choices. Pair the controls with required references and a few preservation rules; do not treat the notes field as a replacement for reference roles.

```yaml
references:
  - id: source-photo
    label: Source photograph
    role: source-photo
    required: true
    preserve: [subject identity, pose, camera viewpoint]
preservation:
  - id: source-identity
    description: Keep the subject identity and viewpoint from the source photograph.
    strength: must
```

The resulting context exposes supplied assertions/source notes separately from the creative interpretation of the reference and prompt. This separation is an instruction boundary, not evidence that the supplied assertions are accurate.

### Multi-stage template

For a research or briefing workflow, add `factuality` controls at the input stage and carry the boundary through collection, prompt composition, generation, and review. `conceptual` mode labels the resulting interpretation as speculative; `mixed` mode requires Codex to keep supplied claims separate from creative interpretation.

```yaml
workflow:
  mode: multi-stage
  stages:
    - { id: collect, title: Collect notes, kind: collect-input, instructions: Record supplied source notes. }
    - { id: compose, title: Compose interpretation, kind: compose-prompt, instructions: Keep supplied claims separate from creative interpretation. }
    - { id: generate, title: Generate image, kind: generate-image, instructions: Label conceptual details as speculation. }
```

### Optional means optional

Normal creative templates should omit both bindings and remain unrestricted. Do not infer factuality from `source`, `references`, or an `x-*` field alone. Unknown `x-*` provenance fields remain inert and must survive validation, retrieval, saving, forking, and JSON export/import unchanged.

---

## 15. Agent authoring procedure

When an agent receives a raw prompt or a natural-language request, it should:

1. **Read the entire source.** Do not infer a template from the title alone.
2. **Write the creative nucleus.** Summarize the task in one paragraph.
3. **Choose operation(s).** Generate, edit, variation, upscale.
4. **Identify reference roles.** Distinguish content, identity, composition, style, palette, material, and mask.
5. **Extract invariants.** Convert “keep this the same” language into preservation rules.
6. **Choose a family.** Use it as a hint, not a constraint.
7. **Create variables.** Only for repeated substitutions.
8. **Create controls.** Only for high-leverage decisions.
9. **Define outputs.** Primary, variations, comparison, or intermediates.
10. **Add workflow stages.** Only if decisions are sequential or dependent.
11. **Add block/layout hints.** Describe relationships, not pixels.
12. **Add attribution.** Preserve provenance.
13. **Run hard validation.** Fix every error.
14. **Run compatibility lint.** Fix real integration problems; document intentional exceptions.
15. **Run creative review.** Improve clarity without flattening the idea.
16. **Instantiate and inspect.** Confirm the generated canvas remains understandable and editable.
17. **Test through Codex.** Read generation context, generate or edit, and import the result.

---

## 16. Agent decision examples

### A long prompt with one replaceable city

Keep the full prompt body. Add a `city_name` variable, an aspect-ratio control, and only a few meaningful preset choices.

### A one-sentence style prompt

Do not manufacture sections. Add one subject field and perhaps palette or aspect ratio.

### A reference-photo transformation

Use an edit operation, one required source slot, and explicit `must` preservation rules.

### A process that interviews the user

Use a multi-stage workflow. Store the resulting blueprint as structured context, then ask Codex to generate.

### A novel idea that does not fit the schema cleanly

Use the minimum core plus `x-*` metadata. Prefer a compatible open template over changing the schema prematurely.

---

## 17. Quality checklist

A template is ready when:

- the prompt still makes sense as prose;
- all required references have clear roles;
- preservation rules capture correctness without micromanaging pixels;
- controls are few enough to understand;
- custom input remains possible where the domain is open;
- outputs match supported operations;
- the template validates;
- lint warnings are resolved or intentional;
- attribution is present where needed;
- the workspace remains useful after the user moves or rewrites elements;
- Codex can resolve generation context and return an image to the correct slot.
