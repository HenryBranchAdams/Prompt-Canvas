export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type GenerationOperation = 'generate' | 'edit' | 'variation' | 'upscale'
export type TemplateFamily =
  | 'lightweight'
  | 'parameterized'
  | 'reference-transformation'
  | 'multi-reference'
  | 'composition-first'
  | 'multi-stage'
  | 'open'

export type PromptCapability =
  | 'text-to-image'
  | 'image-to-image'
  | 'image-edit'
  | 'variations'
  | 'upscale'
  | 'multiple-references'
  | 'composition-reference'
  | 'typography'
  | 'structured-prompt'
  | 'multi-stage-workflow'
  | 'batch-output'
  | 'mask-edit'

export type TemplateSource = {
  kind: 'first-party' | 'user-provided' | 'x-bookmark' | 'web' | 'book' | 'paper' | 'other'
  title: string
  creator?: string
  url?: string | null
  accessedAt?: string
  promptUsage: 'original' | 'inspiration-only' | 'adapted' | 'verbatim-authorized'
  notes?: string
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PromptVariable = {
  id: string
  label: string
  description?: string
  type:
    | 'string'
    | 'text'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'enum'
    | 'multi-enum'
    | 'color'
    | 'json'
    | 'reference'
  required?: boolean
  defaultValue?: JsonValue
  values?: JsonPrimitive[]
  examples?: JsonValue[]
  validation?: {
    minLength?: number
    maxLength?: number
    minimum?: number
    maximum?: number
    pattern?: string
    [extension: `x-${string}`]: JsonValue | undefined
  }
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PromptSection = {
  id: string
  title: string
  body: string
  enabledByDefault?: boolean
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PromptFragment = {
  id: string
  body: string
  enabledByDefault?: boolean
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PromptDefinition = {
  title?: string
  body: string
  negativePrompt?: string
  variables?: PromptVariable[]
  sections?: PromptSection[]
  fragments?: PromptFragment[]
  resolutionOrder?: string[]
  agentInstructions?: string
  [extension: `x-${string}`]: JsonValue | undefined
}

export type ControlType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'range'
  | 'enum'
  | 'multi-enum'
  | 'chips'
  | 'multi-chips'
  | 'combobox'
  | 'toggle'
  | 'color'
  | 'color-palette'
  | 'aspect-ratio'
  | 'reference'
  | 'reference-list'
  | 'composition'
  | 'freeform'
  | 'json'
  | 'hidden'

export type ControlBinding = {
  mode:
    | 'variable'
    | 'prompt-fragment'
    | 'negative-prompt'
    | 'generation'
    | 'workflow'
    | 'agent-context'
    | 'preservation'
  target: string
  renderAs?: string
  [extension: `x-${string}`]: JsonValue | undefined
}

export type ControlOption = {
  label: string
  value: JsonPrimitive
  description?: string
  disabled?: boolean
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PromptControl = {
  id: string
  label: string
  type: ControlType
  helpText?: string
  required?: boolean
  defaultValue?: JsonValue
  options?: ControlOption[]
  suggestions?: JsonValue[]
  allowCustom?: boolean
  min?: number
  max?: number
  step?: number
  groupId?: string
  binding: ControlBinding
  visibility?: {
    whenControlId: string
    operator: 'equals' | 'not-equals' | 'contains' | 'exists'
    value?: JsonValue
    [extension: `x-${string}`]: JsonValue | undefined
  }
  ui?: {
    width?: 'auto' | 'narrow' | 'medium' | 'wide' | 'full'
    compact?: boolean
    order?: number
    placeholder?: string
    [extension: `x-${string}`]: JsonValue | undefined
  }
  [extension: `x-${string}`]: JsonValue | undefined
}

export type ReferenceSlot = {
  id: string
  label: string
  role:
    | 'content'
    | 'identity'
    | 'composition'
    | 'style'
    | 'palette'
    | 'material'
    | 'mask'
    | 'source-photo'
    | 'logo'
    | 'other'
  description?: string
  required?: boolean
  multiple?: boolean
  minItems?: number
  maxItems?: number
  acceptedMimeTypes?: string[]
  preserve?: string[]
  instructions?: string
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PreservationRule = {
  id: string
  label?: string
  description: string
  strength: 'must' | 'prefer' | 'may'
  appliesTo?: string[]
  [extension: `x-${string}`]: JsonValue | undefined
}

export type OutputSlot = {
  id: string
  label: string
  role: 'primary' | 'variation' | 'comparison' | 'intermediate' | 'reference' | 'archive'
  kind: 'image' | 'image-set' | 'structured-context' | 'text'
  count?: number
  aspectRatio?: string
  operations?: GenerationOperation[]
  layoutHint?: 'hero' | 'strip' | 'grid' | 'pair' | 'stack' | 'free'
  required?: boolean
  [extension: `x-${string}`]: JsonValue | undefined
}

export type WorkspaceBlock = {
  id: string
  type:
    | 'prompt'
    | 'controls'
    | 'references'
    | 'output'
    | 'variations'
    | 'notes'
    | 'workflow'
    | 'comparison'
    | 'gallery'
    | 'freeform'
    | 'json'
    | 'custom'
  title?: string
  sourceId?: string
  region?: string
  order?: number
  collapsedByDefault?: boolean
  lockedByDefault?: boolean
  content?: JsonValue
  /** First-party layout hint for directed canvas workflow connections. */
  'x-connectTo'?: string | string[]
  [extension: `x-${string}`]: JsonValue | undefined
}

export type WorkflowStage = {
  id: string
  title: string
  kind:
    | 'collect-input'
    | 'agent-reasoning'
    | 'compose-prompt'
    | 'generate-image'
    | 'edit-image'
    | 'select-output'
    | 'review'
    | 'custom'
  instructions?: string
  inputs?: string[]
  produces?: string[]
  requiresUserChoice?: boolean
  optional?: boolean
  nextStageIds?: string[]
  [extension: `x-${string}`]: JsonValue | undefined
}

export type WorkflowStageStatus = 'not-started' | 'active' | 'complete' | 'skipped'

export type PromptWorkflow = {
  mode: 'single-stage' | 'guided' | 'multi-stage' | 'branching'
  stages: WorkflowStage[]
  entryStageId?: string
  allowAgentAdaptation?: boolean
  [extension: `x-${string}`]: JsonValue | undefined
}

export type TemplateLayout = {
  mode: 'auto' | 'freeform' | 'seeded'
  arrangement?:
    | 'prompt-left-output-right'
    | 'prompt-top-output-bottom'
    | 'reference-transform'
    | 'comparison'
    | 'workflow-board'
    | 'gallery'
    | 'open-canvas'
    | 'custom'
  seed?: number
  preserveManualGeometry?: boolean
  regions?: Array<{
    id: string
    label?: string
    purpose?: string
    preferredSide?: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'free'
    [extension: `x-${string}`]: JsonValue | undefined
  }>
  [extension: `x-${string}`]: JsonValue | undefined
}

export type PromptWorkspaceTemplate = {
  schema: 'prompt-canvas.prompt-workspace-template@2'
  id: string
  version: number
  title: string
  description: string
  category?: string
  tags?: string[]
  status?: 'draft' | 'starter' | 'published' | 'archived'
  compatibility?: {
    minimumAppVersion?: string
    templateFamily?: TemplateFamily
    requiresCapabilities?: PromptCapability[]
    [extension: `x-${string}`]: JsonValue | undefined
  }
  source?: TemplateSource
  thumbnail?: {
    assetPath: string
    alt: string
    accent?: string
    [extension: `x-${string}`]: JsonValue | undefined
  }
  capabilities?: PromptCapability[]
  generation: {
    provider: 'codex'
    capability: 'image-generation'
    delivery: 'webmcp-import'
    operations: GenerationOperation[]
    defaultOperation?: GenerationOperation
    defaultVariationCount?: number
    preferredMimeTypes?: string[]
    modelHint?: string
    qualityHint?: 'auto' | 'draft' | 'standard' | 'high'
    backgroundHint?: 'auto' | 'opaque' | 'transparent'
    [extension: `x-${string}`]: JsonValue | undefined
  }
  prompt: PromptDefinition
  controlGroups?: Array<{
    id: string
    label: string
    description?: string
    collapsedByDefault?: boolean
    order?: number
    [extension: `x-${string}`]: JsonValue | undefined
  }>
  controls?: PromptControl[]
  references?: ReferenceSlot[]
  preservation?: PreservationRule[]
  workflow?: PromptWorkflow
  blocks?: WorkspaceBlock[]
  layout?: TemplateLayout
  outputs: OutputSlot[]
  annotations?: Array<{
    id: string
    text: string
    kind: 'note' | 'tip' | 'warning' | 'source' | 'example'
    [extension: `x-${string}`]: JsonValue | undefined
  }>
  limits?: {
    maxReferenceBytes?: number
    maxGeneratedAssetBytes?: number
    maxWorkspaceAssets?: number
    maxResolvedPromptCharacters?: number
    [extension: `x-${string}`]: JsonValue | undefined
  }
  [extension: `x-${string}`]: JsonValue | undefined
}

export type TemplateManifestEntry = {
  id: string
  path: string
  title: string
  description: string
  category: string
  family: TemplateFamily
  operations: GenerationOperation[]
  capabilities: PromptCapability[]
  featured: boolean
  order: number
  source?: {
    creator?: string
    title?: string
    url?: string | null
    promptUsage?: string
  }
}

export type StarterManifest = {
  schema: 'prompt-canvas.starter-pack@2'
  id: string
  version: number
  title: string
  description?: string
  templateSchema: string
  templateCount: number
  templates: TemplateManifestEntry[]
  research?: JsonObject
}

export type GenerationState =
  | 'empty'
  | 'ready-for-codex'
  | 'generating-in-codex'
  | 'importing'
  | 'complete'
  | 'stale-context'
  | 'failed'

export type WorkspaceManifest = {
  schema: 'prompt-canvas.workspace@1'
  workspaceId: string
  templateId?: string
  templateVersion?: number
  templateSource?: {
    origin: 'official' | 'local'
    id: string
    version: number
    hash?: string
  }
  title: string
  activePromptId: string
  documentRevision: number
  generationRevision: number
  createdAt: string
  updatedAt: string
  templateSnapshot: PromptWorkspaceTemplate
  controlValues: Record<string, JsonValue>
  generationState: GenerationState
  latestGenerationRequestId?: string
  pendingAssetCleanupIds?: string[]
}

export type ReferenceAsset = {
  assetId: string
  slotId: string
  purpose: string
  mimeType: string
  width?: number
  height?: number
  altText?: string
  required: boolean
}

export type GeneratedAssetProvenance = {
  schema: 'prompt-canvas.asset-provenance@1'
  assetId: string
  workspaceId: string
  outputSlotId: string
  provider: 'codex'
  operation: GenerationOperation
  requestId: string
  generationRevision: number
  promptDigest?: string
  parentAssetIds: string[]
  mimeType: string
  width: number
  height: number
  byteLength: number
  byteDigest?: string
  createdAt: string
  promoted: boolean
  archived?: boolean
  label?: string
}

export type AssetTransportKind = 'host_attachment' | 'data_url' | 'https_url'

export type FactualityMode = 'supplied' | 'conceptual' | 'mixed'

/**
 * Optional, control-driven boundaries for source-backed versus creative content.
 * Normal templates omit this object entirely.
 */
export type FactualityContext = {
  mode: FactualityMode
  sourceNotes: string
  suppliedClaims: string | null
  creativeInterpretation: string | null
}

export type GeneratedAssetReturnInstructions = {
  acceptedTransports: AssetTransportKind[]
  preferredTransport: AssetTransportKind | null
  directDataUrlFields: string[]
  rawBase64DataUrlTemplate: string
  ignoredLocalPathFields: string[]
  prohibitedSchemes: string[]
  fallbackTransport: 'host_attachment' | null
}

export type GenerationContext = {
  schema: 'prompt-canvas.generation-context@1'
  workspaceId: string
  requestId: string
  documentRevision: number
  generationRevision: number
  promptDigest: string
  targetOutputId: string
  operation: GenerationOperation
  rawPrompt: string
  resolvedPrompt: string
  negativePrompt: string
  controlContext: Record<string, JsonValue>
  references: ReferenceAsset[]
  preservation: PreservationRule[]
  outputRequirements: {
    aspectRatio: string
    requestedCount: number
    preferredMimeTypes: string[]
  }
  selection: null | { semanticIds: string[]; assetIds: string[] }
  verifiedAssetTransports: AssetTransportKind[]
  assetReturn: GeneratedAssetReturnInstructions
  factuality?: FactualityContext
  hostInstruction: string
}

export type ValidationIssue = {
  path: string
  message: string
  code: string
}

export type TemplateValidationResult = {
  valid: boolean
  schemaErrors: ValidationIssue[]
  compatibilityWarnings: ValidationIssue[]
  creativeSuggestions: ValidationIssue[]
  normalizedPreview?: PromptWorkspaceTemplate
}

export type ActivitySource = 'codex-host' | 'site-tool' | 'user' | 'system'
export type ActivityEntry = {
  id: string
  at: string
  source: ActivitySource
  kind: string
  summary: string
  workspaceId?: string
  detail?: JsonValue
  status: 'info' | 'success' | 'warning' | 'error'
}

export type AssetSourceInput =
  | { kind: 'host_attachment'; token: string }
  | { kind: 'data_url'; dataUrl: string }
  | { kind: 'https_url'; url: string }

export type ImportedImage = {
  sourceKind: AssetTransportKind
  bytes: Uint8Array
  mimeType: string
  width: number
  height: number
  byteLength: number
  byteDigest: string
}

export type PanelKind =
  | 'prompt'
  | 'controls'
  | 'references'
  | 'output'
  | 'variations'
  | 'workflow'
  | 'json'
  | 'note'

export type PromptPanelPayload = {
  kind: 'prompt'
  promptTitle: string
  body: string
  negativePrompt: string
  displayPart?: 'body' | 'negative' | 'both'
}

export type ControlsPanelPayload = {
  kind: 'controls'
  controls: PromptControl[]
  values: Record<string, JsonValue>
}

export type ReferencePanelItem = ReferenceAsset & { label?: string }
export type ReferencesPanelPayload = {
  kind: 'references'
  slots: ReferenceSlot[]
  items: ReferencePanelItem[]
}

export type OutputPanelPayload = {
  kind: 'output' | 'variations'
  slot: OutputSlot
  /**
   * The operations the current template permits for this output slot. This is
   * duplicated into the panel payload so a persisted panel can render only
   * actions that are valid for its target without needing the template object.
   */
  supportedOperations?: GenerationOperation[]
  assetIds: string[]
  pendingAssetCleanupIds?: string[]
  promotedAssetId?: string
  archivedAssetIds?: string[]
  compareAssetIds?: string[]
  labels?: Record<string, string>
}

export type WorkflowPanelPayload = {
  kind: 'workflow'
  workflow: PromptWorkflow
  statuses: Record<string, WorkflowStageStatus>
}

export type JsonPanelPayload = {
  kind: 'json'
  value: JsonValue
}

export type NotePanelPayload = {
  kind: 'note'
  text: string
  anchorId?: string
  tone?: 'yellow' | 'blue' | 'green' | 'pink' | 'neutral'
}

export type PanelPayload =
  | PromptPanelPayload
  | ControlsPanelPayload
  | ReferencesPanelPayload
  | OutputPanelPayload
  | WorkflowPanelPayload
  | JsonPanelPayload
  | NotePanelPayload

export type PanelDescriptor = {
  semanticId: string
  title: string
  kind: PanelKind
  x: number
  y: number
  w: number
  h: number
  payload: PanelPayload
  locked?: boolean
}

export type WorkspaceUpdateOperation =
  | { op: 'set_prompt_body'; body: string }
  | { op: 'set_negative_prompt'; body: string }
  | { op: 'set_variable'; variableId: string; value: JsonValue }
  | { op: 'set_control'; controlId: string; value: JsonValue }
  | { op: 'add_annotation'; text: string; anchorId?: string }
  | { op: 'move_element'; elementId: string; x: number; y: number }
  | { op: 'resize_element'; elementId: string; width: number; height: number }
  | { op: 'attach_reference'; slotId: string; asset: AssetSourceInput; label?: string }
  | { op: 'remove_reference'; referenceId: string }
  | {
      op: 'set_workflow_stage'
      stageId: string
      status: 'not-started' | 'active' | 'complete' | 'skipped'
    }

export type OutputManagementOperation =
  | { op: 'promote'; assetId: string; slotId?: string }
  | { op: 'compare'; assetIds: string[] }
  | { op: 'reorder'; slotId: string; assetIds: string[] }
  | { op: 'archive'; assetIds: string[] }
  | { op: 'label'; assetId: string; label: string }
  | { op: 'delete'; assetIds: string[] }
