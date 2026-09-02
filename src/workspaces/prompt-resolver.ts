import type {
  FactualityContext,
  FactualityMode,
  GenerationContext,
  GenerationOperation,
  JsonValue,
  OutputSlot,
  PromptControl,
  PromptWorkspaceTemplate,
  ReferenceAsset,
  WorkflowStageStatus,
  WorkspaceManifest,
} from './types.js'
import { shortHash } from './hash.js'

const VARIABLE_PATTERN = /\{\{\s*([a-z][a-z0-9_-]{0,79})\s*\}\}/gi
const MAX_WORKFLOW_STAGE_INSTRUCTIONS = 20_000
const WORKFLOW_STAGE_STATUSES: readonly WorkflowStageStatus[] = [
  'not-started',
  'active',
  'complete',
  'skipped',
]
const FACTUALITY_MODE_TARGET = 'factuality.mode'
const FACTUALITY_SOURCE_NOTES_TARGET = 'factuality.sourceNotes'
const FACTUALITY_MODES: readonly FactualityMode[] = ['supplied', 'conceptual', 'mixed']
const MAX_FACTUALITY_SOURCE_NOTES = 20_000

function printable(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((item) => printable(item)).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function interpolatePrompt(
  rawPrompt: string,
  values: Record<string, JsonValue>,
): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>()
  const text = rawPrompt.replace(VARIABLE_PATTERN, (match, id: string) => {
    const value = values[id]
    const rendered = printable(value)
    if (!rendered) {
      unresolved.add(id)
      return match
    }
    return rendered
  })
  return { text, unresolved: [...unresolved] }
}

export function initialControlValues(template: PromptWorkspaceTemplate): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {}
  for (const variable of template.prompt.variables ?? []) {
    if (variable.defaultValue !== undefined) values[variable.id] = variable.defaultValue
  }
  for (const control of template.controls ?? []) {
    const binding = control.binding
    const fallback = control.defaultValue
    if (binding?.mode === 'variable') {
      if (fallback !== undefined) values[binding.target] = fallback
      else if (!(binding.target in values)) values[binding.target] = ''
    } else if (fallback !== undefined) {
      values[control.id] = fallback
    }
  }
  return values
}

function resolveOutputSlot(template: PromptWorkspaceTemplate, targetOutputId?: string): OutputSlot {
  const requested = targetOutputId
    ? template.outputs.find((output) => output.id === targetOutputId)
    : undefined
  if (targetOutputId !== undefined && !requested) {
    throw new Error(`Output “${targetOutputId}” was not found in template “${template.id}”.`)
  }
  const slot = requested ?? template.outputs.find((output) => output.role === 'primary') ?? template.outputs[0]
  if (!slot || (slot.kind !== 'image' && slot.kind !== 'image-set')) {
    throw new Error('Image generation requires an image output slot.')
  }
  return slot
}

export function resolveGenerationOperation(input: {
  template: PromptWorkspaceTemplate
  requested?: GenerationOperation
  targetOutputId?: string
}): GenerationOperation {
  const { template, requested, targetOutputId } = input
  const slot = resolveOutputSlot(template, targetOutputId)
  if (!slot) throw new Error('The template declares no output slots.')

  if (requested) {
    if (!template.generation.operations.includes(requested)) {
      throw new Error(`Operation “${requested}” is not supported by template “${template.id}”.`)
    }
    if (slot.operations?.length && !slot.operations.includes(requested)) {
      throw new Error(
        `The output “${slot.label}” does not support operation “${requested}”.`,
      )
    }
    return requested
  }

  const targetOperations = (slot.operations?.length
    ? slot.operations
    : template.generation.operations
  ).filter((operation) => template.generation.operations.includes(operation))
  if (!targetOperations.length) {
    throw new Error(`Output “${slot.label}” has no generation operations supported by the template.`)
  }
  const fallback = template.generation.defaultOperation
  return fallback && targetOperations.includes(fallback) ? fallback : targetOperations[0]
}

function resolveWorkflowContext(
  template: PromptWorkspaceTemplate,
  statuses: Record<string, WorkflowStageStatus> | undefined,
  maxPromptCharacters: number,
): JsonValue | undefined {
  const workflow = template.workflow
  if (!workflow) return undefined

  const entryStageId = workflow.entryStageId ?? workflow.stages[0]?.id
  const resolvedStatuses: Record<string, WorkflowStageStatus> = {}
  for (const stage of workflow.stages) {
    const requestedStatus = statuses?.[stage.id]
    resolvedStatuses[stage.id] = WORKFLOW_STAGE_STATUSES.includes(requestedStatus as WorkflowStageStatus)
      ? (requestedStatus as WorkflowStageStatus)
      : stage.id === entryStageId
        ? 'active'
        : 'not-started'
  }

  // Branching workflows may legitimately have more than one active stage.
  // Use the last active stage in declared workflow order as the single bounded
  // instruction focus while retaining every status in the context below.
  const activeStage = [...workflow.stages]
    .reverse()
    .find((stage) => resolvedStatuses[stage.id] === 'active')
  const activeStageInstructions = activeStage?.instructions ?? null
  if (
    activeStageInstructions &&
    (activeStageInstructions.length > MAX_WORKFLOW_STAGE_INSTRUCTIONS ||
      activeStageInstructions.length > maxPromptCharacters)
  ) {
    const limit = Math.min(MAX_WORKFLOW_STAGE_INSTRUCTIONS, maxPromptCharacters)
    throw new Error(
      `Active workflow stage instructions exceed the ${limit}-character limit.`,
    )
  }

  return {
    mode: workflow.mode,
    statuses: resolvedStatuses,
    activeStageId: activeStage?.id ?? null,
    activeStageInstructions,
  } as unknown as JsonValue
}

function isMissingInput(value: JsonValue | undefined): boolean {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
}

function controlValue(control: PromptControl, values: Record<string, JsonValue>): JsonValue | undefined {
  const key = control.binding.mode === 'variable' ? control.binding.target : control.id
  return values[key] === undefined ? control.defaultValue : values[key]
}

function controlIsVisible(
  control: PromptControl,
  controls: PromptControl[],
  values: Record<string, JsonValue>,
): boolean {
  const condition = control.visibility
  if (!condition) return true
  const dependency = controls.find((candidate) => candidate.id === condition.whenControlId)
  const value = dependency ? controlValue(dependency, values) : values[condition.whenControlId]
  switch (condition.operator) {
    case 'equals': return value === condition.value
    case 'not-equals': return value !== condition.value
    case 'exists': return !isMissingInput(value)
    case 'contains': return Array.isArray(value)
      ? value.includes(condition.value ?? null)
      : typeof value === 'string' && typeof condition.value === 'string' && value.includes(condition.value)
  }
}

function assertRequiredInputs(template: PromptWorkspaceTemplate, values: Record<string, JsonValue>): void {
  // Readiness is distinct from template validity. Optional placeholders remain
  // visible; only fields explicitly declared required block a generation.
  for (const variable of template.prompt.variables ?? []) {
    if (variable.required && isMissingInput(values[variable.id])) {
      throw new Error(`Required prompt input “${variable.label}” is missing.`)
    }
  }
  const controls = template.controls ?? []
  for (const control of controls) {
    if (control.required && controlIsVisible(control, controls, values) &&
        isMissingInput(controlValue(control, values))) {
      throw new Error(`Required control “${control.label}” is missing.`)
    }
  }
}

function appendControlContext(
  controls: PromptControl[],
  values: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const context: Record<string, JsonValue> = {}
  for (const control of controls) {
    const binding = control.binding
    if (!binding || binding.mode === 'variable') continue
    const value = values[control.id] ?? control.defaultValue
    if (value !== undefined) context[binding.target] = value
  }
  return context
}

function controlValueForBinding(
  control: PromptControl,
  values: Record<string, JsonValue>,
): JsonValue | undefined {
  if (Object.prototype.hasOwnProperty.call(values, control.id)) return values[control.id]
  if (Object.prototype.hasOwnProperty.call(values, control.binding.target)) {
    return values[control.binding.target]
  }
  return control.defaultValue
}

function resolveFactuality(
  template: PromptWorkspaceTemplate,
  values: Record<string, JsonValue>,
  resolvedPrompt: string,
): FactualityContext | undefined {
  const controls = template.controls ?? []
  const modeControl = controls.find((control) => control.binding?.target === FACTUALITY_MODE_TARGET)
  if (!modeControl) return undefined

  const modeValue = controlValueForBinding(modeControl, values)
  if (typeof modeValue !== 'string' || !FACTUALITY_MODES.includes(modeValue as FactualityMode)) {
    throw new Error(
      `Factuality mode must be one of ${FACTUALITY_MODES.join(', ')} when a factuality.mode control is present.`,
    )
  }
  const mode = modeValue as FactualityMode
  const sourceNotesControl = controls.find(
    (control) => control.binding?.target === FACTUALITY_SOURCE_NOTES_TARGET,
  )
  const sourceNotesValue = sourceNotesControl
    ? controlValueForBinding(sourceNotesControl, values)
    : undefined
  const sourceNotes = printable(sourceNotesValue).trim()
  if (sourceNotes.length > MAX_FACTUALITY_SOURCE_NOTES) {
    throw new Error(
      `Factuality source notes exceed the ${MAX_FACTUALITY_SOURCE_NOTES}-character limit.`,
    )
  }
  if (mode === 'supplied' && !sourceNotes) {
    throw new Error(
      'Factuality mode supplied requires non-empty factuality.sourceNotes; refusing to prepare generation context.',
    )
  }

  return {
    mode,
    sourceNotes,
    suppliedClaims: mode === 'conceptual' ? null : sourceNotes || null,
    creativeInterpretation: mode === 'supplied' ? null : resolvedPrompt,
  }
}

function factualityInstruction(factuality: FactualityContext): string {
  const notes = factuality.sourceNotes
    ? ` The source notes are user-supplied assertions, not independently verified facts: ${JSON.stringify(factuality.sourceNotes)}.`
    : ' No source notes were supplied.'
  if (factuality.mode === 'supplied') {
    return ` Factuality mode “supplied”: use suppliedClaims as the only claims and attribute them as supplied; do not invent or speculate beyond them. Selecting this mode is not proof of accuracy.${notes}`
  }
  if (factuality.mode === 'conceptual') {
    return ` Factuality mode “conceptual”: treat the creative interpretation as speculative; label speculation clearly and do not present it as verified fact. Selecting this mode is not proof of accuracy.${notes}`
  }
  return ` Factuality mode “mixed”: keep suppliedClaims/sourceNotes separate from creativeInterpretation; attribute supplied claims as unverified user assertions and label creative interpretation or speculation. Selecting this mode is not proof of accuracy.${notes}`
}

function defaultAspectRatio(template: PromptWorkspaceTemplate, slot: OutputSlot, values: Record<string, JsonValue>): string {
  const generationControl = (template.controls ?? []).find(
    (control) => control.binding?.mode === 'generation' && control.binding.target === 'aspectRatio',
  )
  const variableAspect = values.aspect_ratio
  const generationAspect = generationControl ? values[generationControl.id] ?? generationControl.defaultValue : undefined
  return printable(generationAspect) || printable(variableAspect) || slot.aspectRatio || 'auto'
}

export function resolveGenerationContext(input: {
  manifest: WorkspaceManifest
  template: PromptWorkspaceTemplate
  rawPrompt: string
  controlValues: Record<string, JsonValue>
  references?: ReferenceAsset[]
  operation?: GenerationOperation
  targetOutputId?: string
  requestedCount?: number
  chatDirection?: string
  selection?: GenerationContext['selection']
  workflowStatuses?: Record<string, WorkflowStageStatus>
  verifiedAssetTransports: GenerationContext['verifiedAssetTransports']
  requestId: string
}): GenerationContext {
  const {
    manifest,
    template,
    rawPrompt,
    controlValues,
    references = [],
    targetOutputId,
    requestedCount,
    chatDirection,
    selection = null,
    workflowStatuses,
    verifiedAssetTransports,
    requestId,
  } = input
  const slot = resolveOutputSlot(template, targetOutputId)
  const operation = resolveGenerationOperation({
    template,
    requested: input.operation,
    targetOutputId,
  })
  assertRequiredInputs(template, controlValues)
  const { text } = interpolatePrompt(rawPrompt, controlValues)
  const maxPromptCharacters = template.limits?.maxResolvedPromptCharacters ?? 120_000
  if (text.length > maxPromptCharacters) {
    throw new Error(
      `Resolved prompt exceeds the ${maxPromptCharacters}-character workspace limit.`,
    )
  }
  const { text: negativePrompt } = interpolatePrompt(template.prompt.negativePrompt ?? '', controlValues)
  if (negativePrompt.length > maxPromptCharacters) {
    throw new Error(
      `Negative prompt exceeds the ${maxPromptCharacters}-character workspace limit.`,
    )
  }
  for (const slot of template.references ?? []) {
    if (!slot.required) continue
    const count = references.filter((reference) => reference.slotId === slot.id).length
    const minimum = Math.max(1, slot.minItems ?? 1)
    if (count < minimum) {
      throw new Error(
        `Reference slot “${slot.label}” requires at least ${minimum} image${minimum === 1 ? '' : 's'}.`,
      )
    }
  }
  const controlContext = appendControlContext(template.controls ?? [], controlValues)
  const boundedChatDirection = chatDirection?.trim()
  if (boundedChatDirection) controlContext.chatDirection = boundedChatDirection.slice(0, 10_000)
  const workflowContext = resolveWorkflowContext(template, workflowStatuses, maxPromptCharacters)
  if (workflowContext !== undefined) controlContext.workflow = workflowContext
  const count = Math.max(
    1,
    Math.min(
      20,
      requestedCount ??
        (slot.role === 'variation'
          ? slot.count ?? template.generation.defaultVariationCount ?? 4
          : slot.count ?? 1),
    ),
  )
  const outputRequirements = {
    aspectRatio: defaultAspectRatio(template, slot, controlValues),
    requestedCount: count,
    preferredMimeTypes: template.generation.preferredMimeTypes ?? ['image/png', 'image/webp'],
  }
  const factuality = resolveFactuality(template, controlValues, text)
  const promptDigest = shortHash({
    resolvedPrompt: text,
    negativePrompt,
    controlContext,
    references: references.map((reference) => ({
      assetId: reference.assetId,
      slotId: reference.slotId,
      purpose: reference.purpose,
      mimeType: reference.mimeType,
      width: reference.width ?? null,
      height: reference.height ?? null,
    })),
    preservation: template.preservation ?? [],
    outputRequirements,
    operation,
    targetOutputId: slot.id,
    selection,
    ...(factuality ? { factuality } : {}),
  })

  return {
    schema: 'prompt-canvas.generation-context@1',
    workspaceId: manifest.workspaceId,
    requestId,
    documentRevision: manifest.documentRevision,
    generationRevision: manifest.generationRevision,
    promptDigest,
    targetOutputId: slot.id,
    operation,
    rawPrompt,
    resolvedPrompt: text,
    negativePrompt,
    controlContext,
    references,
    preservation: template.preservation ?? [],
    outputRequirements,
    selection,
    verifiedAssetTransports,
    ...(factuality ? { factuality } : {}),
    hostInstruction:
      'Use Codex native image generation for this context. Apply controlContext.chatDirection as the latest user direction when present, then return each image with prompt_canvas_add_generated_asset. The page does not generate images itself.' +
      (factuality ? factualityInstruction(factuality) : ''),
  }
}
