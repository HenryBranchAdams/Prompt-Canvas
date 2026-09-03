# Prompt Canvas WebMCP Tool Contracts

**Current machine-readable source:** `schemas/webmcp-tool-catalog.json`

**Canonical operating model:** [`AGENT_SYSTEM.md`](AGENT_SYSTEM.md)

**Status note:** The current catalog implements eleven public tools: the stable original ten-tool compatibility baseline plus guarded workspace deletion. The versioned Situation Packet, envelopes, structured errors, idempotency, preflight, and preview/prepare semantics described as **target** below are planned compatible evolutions until runtime code, schemas, tests, and native-host qualification land.

---

# 1. Host/page responsibility split

A generation trace must remain semantically honest:

```text
Prompt Canvas page: inspect and resolve or preview semantic state
Codex host: reason, converse, generate, edit, vary, or upscale
Prompt Canvas page: validate, import, persist, organize, and evaluate returned assets
```

The page does not register a fake `generate_image` tool, require an OpenAI API key, or silently substitute another provider.

The public interface exposes semantic operations rather than raw tldraw records. Exact geometry, record IDs, history boundaries, asset storage, and migrations remain page implementation details.

---

# 2. Public tool inventory

| Tool | Current mode | Semantic responsibility |
|---|---|---|
| `prompt_canvas_inspect` | Read | Understand the current project, selection, revisions, outputs, capabilities, and page-accepted transports. |
| `prompt_canvas_list_templates` | Read | Search compact summaries from the official catalog and local user-saved recipes. |
| `prompt_canvas_get_template` | Read | Retrieve one exact normalized official or local recipe with source identity and provenance. |
| `prompt_canvas_validate_template` | Read | Separate blocking schema errors from compatibility warnings and creative suggestions. |
| `prompt_canvas_get_generation_context` | Read today; target preview/prepare | Resolve the current project's generation intent and, in target prepare mode, create one exact idempotent request. |
| `prompt_canvas_create_workspace` | Write | Create a semantic project from an exact official or local recipe, definition, or blank prompt. |
| `prompt_canvas_update_workspace` | Write | Apply closed semantic prompt, control, reference, intent, workflow, annotation, or layout operations to one revision-matched project. |
| `prompt_canvas_save_template` | Write | Create, fork, or version a validated user-owned local recipe. |
| `prompt_canvas_add_generated_asset` | Write | Validate and import Codex-generated assets bound to a prepared request. |
| `prompt_canvas_delete_workspace` | Destructive lifecycle write | Delete one confirmed, revision-matched project while preserving at least one project. |
| `prompt_canvas_manage_outputs` | Write | Promote, compare, reorder, label, archive, or explicitly delete outputs. |

Do not add one tool per template, control, shape, workflow stage, or tldraw primitive. Add a tool only when an operation cannot fit honestly within an existing semantic boundary.

---

# 3. Agent protocol principles

## 3.1 Progressive disclosure

The common agent path should be:

```text
orientation inspect
  -> focused or delta inspect only when needed
  -> preflight
  -> one bounded write or prepared generation
  -> receipt or structured recovery
  -> verification/evidence read
```

Inspection returns no image bytes. Long prompt text, complete templates, full activity, and full output histories are opt-in detail.

## 3.2 Pure reads

A read must not:

- change document or generation revision;
- create an undo step;
- upload or remove an asset;
- append a success activity entry;
- create pending external work;
- consume a request;
- mutate selection.

The target generation contract therefore separates pure `preview` from committed `prepare`.

## 3.3 Explicit authority

Tool results should keep these sources distinguishable:

- current explicit user direction;
- workspace must/prefer/may constraints;
- current approved values and decisions;
- declared reference evidence;
- template defaults;
- confirmed learned preference;
- agent inference.

A tool must not resolve a material conflict merely by returning whichever string appeared last.

## 3.4 Bounded actions

Every existing-workspace semantic write is:

- scoped to one workspace;
- validated against a closed schema;
- revision-aware or protected by explicit semantic preconditions;
- atomic;
- immediately visible;
- one-step undoable;
- recorded through a bounded receipt/activity reference.

Workspace creation, workspace deletion, and template-library saves are lifecycle writes. They use their documented validation, persistence, conflict, and result-reporting boundaries; they claim workspace scope, a workspace revision, or a tldraw undo step only when the operation actually has that boundary. Current workspace deletion requires `confirmed: true` and an exact expected revision, refuses to remove the final workspace, selects a remaining managed workspace, and commits as one tldraw history step.

---

# 4. Target protocol envelope

The first agent-control-plane revision should keep legacy compatibility while allowing callers to request a versioned envelope.

A tool input may accept:

```json
{
  "protocolVersion": 1
}
```

The precise negotiation mechanism belongs in the versioned catalog. Until implemented, current result shapes remain authoritative.

## 4.1 Success envelope

```json
{
  "ok": true,
  "protocolVersion": 1,
  "data": {},
  "receipt": {
    "operationId": "op_...",
    "idempotencyKey": "optional-caller-key",
    "beforeState": {
      "documentRevision": 41,
      "generationRevision": 16,
      "stateDigest": "..."
    },
    "afterState": {
      "documentRevision": 42,
      "generationRevision": 17,
      "stateDigest": "..."
    },
    "affectedSemanticIds": ["controls-main"],
    "affectedAssetIds": [],
    "warnings": [],
    "undo": { "available": true },
    "summary": "Updated two generation-relevant controls in one atomic action.",
    "nextActions": []
  }
}
```

Read tools may omit mutation-specific receipt data but should include the current state digest and event cursor.

## 4.2 Error envelope

```json
{
  "ok": false,
  "protocolVersion": 1,
  "error": {
    "code": "STALE_REVISION",
    "message": "The workspace changed after this update was prepared.",
    "scope": { "workspaceId": "ws_..." },
    "retryable": true,
    "latestRevision": 42,
    "latestStateDigest": "...",
    "conflictPaths": ["controls.palette"],
    "recoveryActions": [
      {
        "tool": "prompt_canvas_inspect",
        "input": { "mode": "delta", "sinceCursor": "evt_..." },
        "reason": "Read only the changes since the prior orientation packet."
      }
    ]
  }
}
```

Expected failures need stable codes. Internal exceptions must be sanitized and must not expose raw image data, attachment tokens, private prompt contents beyond what is required, signed URL queries, or implementation stack traces.

Recommended initial codes:

- `INVALID_INPUT`;
- `WORKSPACE_NOT_FOUND`;
- `SEMANTIC_ELEMENT_NOT_FOUND`;
- `STALE_REVISION`;
- `STALE_GENERATION_CONTEXT`;
- `CONSTRAINT_CONFLICT`;
- `NOT_READY`;
- `UNSUPPORTED_OPERATION`;
- `UNQUALIFIED_CAPABILITY`;
- `ASSET_VALIDATION_FAILED`;
- `BUDGET_EXCEEDED`;
- `REQUEST_REPLAY`;
- `IDEMPOTENCY_MISMATCH`;
- `INTERNAL_ERROR`.

---

# 5. `prompt_canvas_inspect`

## 5.1 Current behavior

Reads bounded live workspace state, selection, semantic elements, revisions, outputs, capabilities, activity when requested, and asset transports verified in the active host. It never returns full image bytes.

## 5.2 Target default: Situation Packet

The target default `mode: orientation` returns `prompt-canvas.situation@1` with:

- app, protocol, schema, and catalog versions;
- host capability profile ID and relevant verified capabilities;
- state digest, generation digest, event cursor, and revisions;
- active workspace and attention set;
- persistent goal and deliverable when present;
- constraints grouped by strength and authority;
- decisions, assumptions, open questions, and conflicts;
- readiness for generation and applicable writes;
- compact prompt, controls, references, workflow, and outputs;
- latest relevant receipts and evaluations;
- available next actions with cost, risk, and preconditions.

## 5.3 Target modes

```ts
type InspectMode =
  | 'orientation'
  | 'focused'
  | 'detail'
  | 'delta'
  | 'evidence'
```

Possible target inputs:

- `workspaceId`;
- `mode`;
- `semanticIds` or semantic paths;
- `includeLongPrompt`;
- `sinceCursor`;
- `ifStateDigest`;
- `maxItems`;
- evidence type and limit.

`delta` returns changed semantic paths and bounded events. If nothing relevant changed, it may return `notModified: true` plus current revision and digest.

## 5.4 Economy rule

Orientation should be sufficient to choose the next action in the common case. The agent should not need to retrieve a full template merely to learn that a required identity reference is missing.

---

# 6. Template read tools

## 6.1 `prompt_canvas_list_templates`

Current responsibility: search official and user-owned recipes without mixing their storage or authority boundaries.
Legacy calls continue to search the complete bundled starter pack plus local user recipes. A call with `scope: official`
uses the read-only Official Prompt Library and may combine bounded free text with `intents`, `inputModes`,
`subjectKinds`, `outputKinds`, `preservationNeeds`, `collections`, and `capabilities`. It returns no prompt body and at
most 20 compact candidates. `scope: local` searches only recipes saved in the current browser.

Target summaries may additionally expose separate evidence references:

- qualification state;
- tested-subject count;
- known limitations;
- feature decision;
- evidence freshness.

Do not place growing evidence histories inside immutable template YAML.

## 6.2 `prompt_canvas_get_template`

Returns one complete normalized template definition, validation status, provenance, and source identity. Official
reads accept an exact `version` and `expectedHash`; the application verifies the returned template hash before use and
falls back to the matching bundled official version when D1 is unavailable. Local reads never contact the official
service. A project created from an official result records source, id, version, and hash in its immutable template
snapshot metadata so later catalog changes cannot rewrite an existing project.

Target behavior should support optional omission of large prompt fields for summary reads and stable retrieval of separate template evidence.

## 6.3 `prompt_canvas_validate_template`

Preserves three distinct layers:

1. blocking schema validation;
2. non-blocking compatibility lint;
3. advisory creative review.

Target validation may add an agent-legibility review covering:

- coupled defaults;
- reference authority ambiguity;
- absent evaluation criteria for a high-risk workflow;
- unsupported host/API controls;
- unbounded or contradictory instructions;
- lack of materially different test subjects before featuring.

These remain advisory unless the issue prevents safe interoperability.

---

# 7. `prompt_canvas_get_generation_context`

## 7.1 Current behavior

Creates a request ID and resolves the prompt, negative prompt, controls, optional chat direction, references, preservation rules, workflow state, source selection, target output, operation, generation revision, prompt digest, and verified transports. It does not generate an image.

## 7.2 Target behavior: `preview`

`mode: preview` is pure and should be the default.

It returns:

- readiness: ready or blocked;
- blockers and recovery actions;
- context digest and state preconditions;
- purpose and deliverable;
- raw and resolved creative brief;
- hard constraints and factuality boundary;
- reference authority map;
- structured controls and preferences;
- operation, sources, parents, and target;
- output contract;
- compiled evaluation rubric;
- verified host capabilities;
- reuse recommendation.

It creates no pending request or activity success entry.

## 7.3 Target behavior: `prepare`

`mode: prepare` is a deliberate transition.

Required target inputs include:

- workspace ID;
- operation and target;
- optional selected sources;
- idempotency key;
- expected generation revision or context digest;
- optional run ID;
- explicit override only for supported non-blocking warnings.

It returns:

- request ID;
- context token;
- context digest;
- prepared timestamp and expiry;
- exact operation/source/target/count binding;
- commit preconditions;
- receipt.

Same idempotency key plus unchanged intent returns the same request. Changed intent returns `IDEMPOTENCY_MISMATCH` rather than creating a second ambiguous request.

## 7.4 Request states

Target lifecycle:

- `prepared`;
- `consumed`;
- `expired`;
- `cancelled`;
- `invalidated-by-generation-revision`.

Request persistence and reload semantics must be explicit and tested. Do not imply a pending request survives reload unless it actually does.

---

# 8. Workspace write tools

## 8.1 Shared target inputs

Applicable write tools should accept:

- `protocolVersion`;
- `idempotencyKey`;
- `mode: preflight | commit` where appropriate;
- workspace ID;
- expected revision or semantic preconditions;
- optional run ID;
- bounded reason.

## 8.2 Preflight

Preflight performs:

- input normalization;
- semantic path resolution;
- authority and constraint conflict checks;
- revision and capability checks;
- affected-entity calculation;
- generation-relevance calculation;
- risk and cost classification;
- warning and recovery generation.

It must not:

- mutate state;
- create history;
- change revisions;
- upload assets;
- create a pending generation request;
- add a success activity event.

## 8.3 `prompt_canvas_create_workspace`

Current inputs remain template, complete definition, or minimal blank prompt. The page chooses stable IDs and exact geometry.

Target preflight can show:

- normalized template;
- synthesized panels;
- missing requirements;
- capability requirements;
- estimated page and asset impact;
- warnings about coupled defaults or absent references.

## 8.4 `prompt_canvas_update_workspace`

Current operation families include prompt, controls, references, workflow, annotations, move, and resize.

The target closed vocabulary may add:

- `set_goal`;
- `upsert_constraint`;
- `record_decision`;
- `record_assumption`;
- `upsert_open_question`;
- `pin_attention`;
- optional Run lifecycle operations if they remain coherent here.

Do not accept arbitrary tldraw records or executable content.

## 8.5 `prompt_canvas_save_template`

Creates, versions, or forks user-owned reusable templates after validation. Bundled starters remain immutable.

Target behavior should keep template definitions separate from growing run/output evidence by default. Saving may optionally retain approved, portable evidence references but must not copy private workspace history or generated bytes silently.

## 8.6 `prompt_canvas_delete_workspace`

The current additive lifecycle tool deletes one managed workspace page only when `confirmed` is exactly `true` and `expectedRevision` matches that workspace. It refuses to delete the final remaining workspace, selects a remaining managed workspace after success, reports the deleted and active identifiers, and makes the deletion one tldraw undo step. A failed confirmation, stale revision, unknown workspace, or final-workspace attempt changes nothing.

---

# 9. `prompt_canvas_add_generated_asset`

## 9.1 Current responsibility

Imports one or more Codex-generated images, validates request freshness and bytes, records lineage, stores assets, and places them into output slots.

## 9.2 Binding requirements

Each returned asset remains bound to:

- workspace;
- prepared request;
- generation revision;
- context/prompt digest;
- output slot;
- operation;
- parent assets where required;
- declared and decoded type;
- qualified transport.

## 9.3 Target request token

The target import should validate the prepared context token and request lifecycle in addition to current IDs and digests.

A consumed, expired, cancelled, invalidated, mismatched, cross-workspace, or replayed request publishes nothing.

## 9.4 Atomic batch behavior

When the tool promises an atomic batch:

- all semantic checks occur first;
- all bytes are prepared and validated before the editor transaction;
- one failure publishes none;
- ordering remains stable;
- one successful import is one undo step;
- result includes one receipt and per-asset lineage.

## 9.5 Evaluation readiness

Import should return the compiled rubric reference or enough linkage for an evaluation record. It should not claim the pixels pass the rubric automatically.

---

# 10. `prompt_canvas_manage_outputs`

Current operations promote, compare, reorder, label, archive, or explicitly delete outputs.

Target preflight should distinguish:

- reversible presentation changes;
- archive changes;
- destructive underlying asset deletion;
- effects on lineage, evaluations, and active Runs.

Removing an item from a comparison never silently deletes the source asset. Deleting an asset must preserve or safely tombstone provenance and evaluation references according to the persisted-data contract.

An agent may recommend promotion. Human aesthetic approval remains distinct, and a failed must-level evaluation criterion should normally block automatic promotion.

---

# 11. Idempotency and replay

## 11.1 Writes

An idempotency record binds:

- caller key;
- normalized semantic intent digest;
- scope;
- original result or receipt reference;
- expiry or retention policy.

Replay with identical intent returns the original result where safe. Replay with different intent returns `IDEMPOTENCY_MISMATCH`.

## 11.2 Generation

Prepared generation idempotency is separate from returned byte digest. Two valid requests may produce identical bytes; one request may not publish twice merely because the bytes differ.

## 11.3 Retention

Idempotency storage must be bounded. The retention period should cover realistic host retries without becoming an unbounded activity archive.

---

# 12. Cost, risk, and next-action hints

Situation Packets, preflight results, receipts, and errors may return actions such as:

```json
{
  "tool": "prompt_canvas_get_generation_context",
  "input": { "mode": "preview", "operation": "edit" },
  "reason": "A targeted edit preserves the passing composition and costs less than a new series.",
  "costClass": "free-read",
  "riskClass": "reversible",
  "preconditions": ["selected-asset-present"]
}
```

Cost classes describe local control strategy, not platform billing:

- `free-read`;
- `low-local`;
- `expensive-external`.

Risk classes:

- `reversible`;
- `review-required`;
- `destructive`.

Tool hints remain recommendations. They do not grant authority or trigger work automatically.

---

# 13. Asset transports and host profiles

Candidate schema representations are:

- `host_attachment`;
- `data_url`;
- `https_url`.

Today, the page accepts only `data_url` after a bounded parser self-test. Release-host qualification is recorded
separately in `HOST_QUALIFICATION.md`. `host_attachment` and `https_url` remain input-schema compatibility cases but
are disabled and unadvertised until their exact adapters receive deployed-host qualification.

Inspect and generation context expose only the currently supported transport set. Configured application limits remain separate from observed host maxima. A different desktop build, origin, deployment, MIME type, or request lifecycle may require requalification.

---

# 14. Backward-compatible migration

Recommended sequence:

1. add optional protocol negotiation;
2. implement Situation Packet and envelope types internally;
3. expose them only when requested;
4. update app UI and tests to use the new path;
5. add structured errors and idempotency;
6. introduce generation preview/prepare;
7. qualify the exact desktop-host flow;
8. make the new protocol default only through an explicit release decision;
9. retain or retire legacy responses through a documented deprecation window.

Existing saved workspaces, template definitions, output lineage, and qualified `data_url` imports must remain readable throughout.

---

# 15. Contract quality checklist

A WebMCP contract is agent-ergonomic when:

- the name states the actual authority boundary;
- the default read answers the next-decision question;
- detail can be fetched without rereading everything;
- reads are pure;
- mutation and external commitment are explicit;
- inputs are narrow and semantically closed;
- authority and conflicts remain visible;
- output says what changed and how to recover;
- idempotency protects retries;
- revisions and digests protect stale state;
- cost and risk are legible;
- evidence is attributable;
- no unsupported host capability is implied;
- another agent can resume without reconstructing hidden state.
