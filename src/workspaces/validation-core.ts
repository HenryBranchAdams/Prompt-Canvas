import type {
  PromptWorkspaceTemplate,
  TemplateValidationResult,
  ValidationIssue,
} from './types.js'

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g
const TEMPLATE_SCHEMA = 'prompt-canvas.prompt-workspace-template@2' as const
const MAX_ASPECT_RATIO_DIGITS = 9

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalRatio(numerator: bigint, denominator: bigint): string | undefined {
  if (numerator <= 0n || denominator <= 0n) return undefined
  let left = numerator
  let right = denominator
  while (right !== 0n) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return `${numerator / left}:${denominator / left}`
}

function normalizeAspectRatio(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const ratio = value.trim()
  if (ratio === 'auto') return ratio

  const slash = new RegExp(
    `^([1-9][0-9]{0,${MAX_ASPECT_RATIO_DIGITS - 1}})\\s*/\\s*([1-9][0-9]{0,${MAX_ASPECT_RATIO_DIGITS - 1}})$`,
  ).exec(ratio)
  if (slash) return canonicalRatio(BigInt(slash[1]!), BigInt(slash[2]!)) ?? value

  const decimal = new RegExp(
    `^(0|[1-9][0-9]{0,${MAX_ASPECT_RATIO_DIGITS - 1}})\\.([0-9]{1,${MAX_ASPECT_RATIO_DIGITS}})$`,
  ).exec(ratio)
  if (!decimal) return value

  const whole = BigInt(decimal[1]!)
  const fraction = decimal[2]!
  const scale = 10n ** BigInt(fraction.length)
  return canonicalRatio(whole * scale + BigInt(fraction), scale) ?? value
}

/**
 * Author input may omit invariant transport boilerplate. Persisted templates
 * remain fully explicit, and shorthand aspect ratios are canonicalized before
 * schema validation.
 */
export function normalizeTemplateInput(candidate: unknown): unknown {
  if (!isRecord(candidate)) return candidate

  const normalized: Record<string, unknown> = { ...candidate }
  if (!Object.hasOwn(normalized, 'schema')) normalized.schema = TEMPLATE_SCHEMA

  if (isRecord(normalized.generation)) {
    normalized.generation = {
      ...normalized.generation,
      ...(!Object.hasOwn(normalized.generation, 'provider') ? { provider: 'codex' } : {}),
      ...(!Object.hasOwn(normalized.generation, 'capability')
        ? { capability: 'image-generation' }
        : {}),
      ...(!Object.hasOwn(normalized.generation, 'delivery')
        ? { delivery: 'webmcp-import' }
        : {}),
    }
  }

  if (Array.isArray(normalized.outputs)) {
    normalized.outputs = normalized.outputs.map((output) =>
      isRecord(output) && Object.hasOwn(output, 'aspectRatio')
        ? { ...output, aspectRatio: normalizeAspectRatio(output.aspectRatio) }
        : output,
    )
  }

  return normalized
}

function duplicateIdIssues(
  values: ReadonlyArray<{ id: string }> | undefined,
  path: string,
): ValidationIssue[] {
  if (!values) return []
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id)
    seen.add(value.id)
  }
  return [...duplicates].map((id) =>
    issue(path, 'compatibility.duplicate-id', `The id “${id}” is used more than once.`),
  )
}

/** Cross-reference validation keeps malformed workflow graphs out of runtime. */
export function workflowValidationErrors(template: PromptWorkspaceTemplate): ValidationIssue[] {
  const workflow = template.workflow
  if (!workflow) return []

  const errors: ValidationIssue[] = []
  const usesGraphReferences =
    workflow.mode === 'branching' ||
    workflow.entryStageId !== undefined ||
    workflow.stages.some((stage) => (stage.nextStageIds?.length ?? 0) > 0)
  const stageIds = new Set<string>()
  for (const stage of workflow.stages) {
    if (usesGraphReferences && stageIds.has(stage.id)) {
      errors.push(
        issue(
          '/workflow/stages',
          'schema.workflow.duplicate-stage-id',
          `The workflow stage id “${stage.id}” is used more than once.`,
        ),
      )
    }
    stageIds.add(stage.id)
  }

  if (workflow.entryStageId) {
    if (!stageIds.has(workflow.entryStageId)) {
      errors.push(
        issue(
          '/workflow/entryStageId',
          'schema.workflow.unknown-entry-stage',
          `The entry stage “${workflow.entryStageId}” does not match a workflow stage.`,
        ),
      )
    }
  } else if (workflow.mode === 'branching') {
    errors.push(
      issue(
        '/workflow/entryStageId',
        'schema.workflow.branching-entry-stage-required',
        'Branching workflows require an entryStageId.',
      ),
    )
  }

  for (const stage of workflow.stages) {
    for (const nextStageId of stage.nextStageIds ?? []) {
      if (!stageIds.has(nextStageId)) {
        errors.push(
          issue(
            `/workflow/stages/${stage.id}/nextStageIds`,
            'schema.workflow.unknown-next-stage',
            `The next stage “${nextStageId}” does not match a workflow stage.`,
          ),
        )
      }
    }
  }

  return errors
}

export function compatibilityLint(template: PromptWorkspaceTemplate): ValidationIssue[] {
  const warnings: ValidationIssue[] = []
  warnings.push(...duplicateIdIssues(template.controls, '/controls'))
  warnings.push(...duplicateIdIssues(template.references, '/references'))
  warnings.push(...duplicateIdIssues(template.outputs, '/outputs'))
  warnings.push(...duplicateIdIssues(template.blocks, '/blocks'))
  warnings.push(...duplicateIdIssues(template.workflow?.stages, '/workflow/stages'))

  const operations = new Set(template.generation.operations)
  if (
    template.generation.defaultOperation &&
    !operations.has(template.generation.defaultOperation)
  ) {
    warnings.push(
      issue(
        '/generation/defaultOperation',
        'compatibility.default-operation',
        'The default operation is not included in generation.operations.',
      ),
    )
  }

  const primaryOutputs = template.outputs.filter((output) => output.role === 'primary')
  if (primaryOutputs.length === 0) {
    warnings.push(
      issue(
        '/outputs',
        'compatibility.no-primary-output',
        'No primary output is declared. The app will use the first output.',
      ),
    )
  } else if (primaryOutputs.length > 1) {
    warnings.push(
      issue(
        '/outputs',
        'compatibility.multiple-primary-outputs',
        'Multiple primary outputs are valid, but an explicit default target would reduce ambiguity.',
      ),
    )
  }

  if (operations.has('edit') && (template.references?.length ?? 0) === 0) {
    warnings.push(
      issue(
        '/references',
        'compatibility.edit-without-reference',
        'The template supports image editing but declares no reference slot or source-output workflow.',
      ),
    )
  }

  const knownVariables = new Set<string>()
  for (const variable of template.prompt.variables ?? []) knownVariables.add(variable.id)
  for (const control of template.controls ?? []) {
    if (control.binding.mode === 'variable') knownVariables.add(control.binding.target)
  }

  const promptText = [
    template.prompt.body,
    template.prompt.negativePrompt ?? '',
    ...(template.prompt.sections?.map((section) => section.body) ?? []),
  ].join('\n')
  const usedVariables = new Set<string>()
  for (const match of promptText.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (name) usedVariables.add(name)
  }

  for (const name of usedVariables) {
    if (!knownVariables.has(name)) {
      warnings.push(
        issue(
          '/prompt/body',
          'compatibility.unbound-variable',
          `The placeholder “{{${name}}}” has no declared variable or variable-bound control.`,
        ),
      )
    }
  }

  for (const control of template.controls ?? []) {
    if (control.binding.mode === 'variable' && !usedVariables.has(control.binding.target)) {
      warnings.push(
        issue(
          `/controls/${control.id}/binding`,
          'compatibility.unused-variable-control',
          `The control targets “${control.binding.target}”, but that placeholder does not appear in the prompt.`,
        ),
      )
    }
  }

  const outputIds = new Set(template.outputs.map((output) => output.id))
  const blockIds = new Set(template.blocks?.map((block) => block.id) ?? [])
  for (const block of template.blocks ?? []) {
    if (block.sourceId && !outputIds.has(block.sourceId) && !blockIds.has(block.sourceId)) {
      warnings.push(
        issue(
          `/blocks/${block.id}/sourceId`,
          'compatibility.unknown-block-source',
          `The block source “${block.sourceId}” does not match an output or block id.`,
        ),
      )
    }
  }

  const requiredReferences = (template.references ?? []).filter((reference) => reference.required)
  if (requiredReferences.length > 0 && operations.has('generate') && operations.size === 1) {
    warnings.push(
      issue(
        '/generation/operations',
        'compatibility.generate-requires-reference',
        'This generate-only template has required reference inputs. Confirm that text-to-image is intended.',
      ),
    )
  }

  return warnings
}

export function creativeReview(template: PromptWorkspaceTemplate): ValidationIssue[] {
  const suggestions: ValidationIssue[] = []
  const controlCount = template.controls?.length ?? 0
  const promptLength = template.prompt.body.trim().length

  if (promptLength < 60) {
    suggestions.push(
      issue(
        '/prompt/body',
        'creative.prompt-clarity',
        'The prompt is intentionally compact. Add composition or preservation detail only when it materially improves repeatability.',
      ),
    )
  }

  if (controlCount > 12 && (template.controlGroups?.length ?? 0) === 0) {
    suggestions.push(
      issue(
        '/controls',
        'creative.group-controls',
        'This workspace has many controls. Optional groups may make the canvas easier to scan without changing compatibility.',
      ),
    )
  }

  if (controlCount === 0 && (template.prompt.variables?.length ?? 0) > 0) {
    suggestions.push(
      issue(
        '/controls',
        'creative.surface-variables',
        'The prompt declares reusable variables but no controls. This is valid; surface only variables users change often.',
      ),
    )
  }

  if ((template.references?.length ?? 0) > 0 && (template.preservation?.length ?? 0) === 0) {
    suggestions.push(
      issue(
        '/preservation',
        'creative.reference-invariants',
        'Reference-driven work often benefits from one or two explicit invariants such as identity, pose, geometry, viewpoint, or spatial relationships.',
      ),
    )
  }

  if (!template.prompt.negativePrompt && promptLength > 500) {
    suggestions.push(
      issue(
        '/prompt/negativePrompt',
        'creative.failure-modes',
        'A long prompt may benefit from a few concrete negative constraints, but avoid turning every preference into a prohibition.',
      ),
    )
  }

  if (!template.source) {
    suggestions.push(
      issue(
        '/source',
        'creative.provenance',
        'Add source metadata when the template adapts an external example; original templates may omit it.',
      ),
    )
  }

  return suggestions
}

export function createValidationResult(
  template: PromptWorkspaceTemplate,
  mode: 'schema-only' | 'compatibility' | 'full',
): TemplateValidationResult {
  return {
    valid: true,
    schemaErrors: [],
    compatibilityWarnings: mode === 'schema-only' ? [] : compatibilityLint(template),
    creativeSuggestions: mode === 'full' ? creativeReview(template) : [],
    normalizedPreview: structuredClone(template),
  }
}
