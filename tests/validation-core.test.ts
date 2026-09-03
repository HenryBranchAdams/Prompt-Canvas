import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockExtensionValidationErrors,
  compatibilityLint,
  createValidationResult,
  creativeReview,
  normalizeTemplateInput,
  workflowValidationErrors,
} from '../src/workspaces/validation-core.js'
import { createBlankTemplate } from '../src/library/template-library-core.js'
import type { PromptWorkspaceTemplate } from '../src/workspaces/types.js'

test('compatibility lint is non-blocking and catches unresolved variables', () => {
  const template = createBlankTemplate('Flexible template', 'Create {{subject}} with {{unknown}}.')
  template.prompt.variables = [{ id: 'subject', label: 'Subject', type: 'string' }]
  const warnings = compatibilityLint(template)
  assert.ok(warnings.some((warning) => warning.code === 'compatibility.unbound-variable'))
})

test('creative review does not reject intentionally minimal prompts', () => {
  const template = createBlankTemplate('Tiny', 'A red circle.')
  const suggestions = creativeReview(template)
  assert.ok(suggestions.some((suggestion) => suggestion.code === 'creative.prompt-clarity'))
})

test('JSON-style template round trips retain source attribution and inert provenance fields', () => {
  const template = createBlankTemplate('Reviewed template', 'Create a quiet travel image.')
  template.source = {
    kind: 'x-bookmark',
    title: 'Reviewed source prompt',
    creator: 'Source creator',
    url: 'https://example.com/reviewed-source',
    accessedAt: '2026-08-29',
    promptUsage: 'adapted',
    notes: 'Reviewed and normalized before runtime use.',
    'x-review': { status: 'reviewed' },
  }
  template['x-provenance'] = { sourceRecord: 'source-123' }
  template.prompt['x-prompt-provenance'] = { sourceRecord: 'source-123' }
  template.controls![0]!['x-control-provenance'] = { sourceRecord: 'source-123' }
  template.controls![0]!.binding['x-binding-provenance'] = { reviewed: true }

  const result = createValidationResult(
    JSON.parse(JSON.stringify(template)) as PromptWorkspaceTemplate,
    'full',
  )

  assert.equal(result.valid, true)
  assert.deepEqual(result.normalizedPreview?.source, template.source)
  assert.deepEqual(result.normalizedPreview?.['x-provenance'], template['x-provenance'])
  assert.deepEqual(
    result.normalizedPreview?.prompt['x-prompt-provenance'],
    template.prompt['x-prompt-provenance'],
  )
  assert.deepEqual(
    result.normalizedPreview?.controls?.[0]?.binding['x-binding-provenance'],
    template.controls?.[0]?.binding['x-binding-provenance'],
  )
})

test('active block extensions reject unknown semantic references and invalid block types', () => {
  const template = createBlankTemplate('Modular validation', 'Create a modular study.')
  template.blocks = [
    { id: 'wrong-kind', type: 'notes', 'x-controlIds': ['missing'], 'x-connectTo': 'missing-target' },
    { id: 'wrong-prompt-kind', type: 'controls', 'x-promptPart': 'body' },
    { id: 'self-connected', type: 'prompt', 'x-connectTo': 'self-connected' },
  ]

  const errors = blockExtensionValidationErrors(template)
  assert.ok(errors.some((error) => error.code === 'schema.block-extension.control-type'))
  assert.ok(errors.some((error) => error.code === 'schema.block-extension.unknown-control'))
  assert.ok(errors.some((error) => error.code === 'schema.block-extension.prompt-type'))
  assert.ok(errors.some((error) => error.code === 'schema.block-extension.unknown-connection-target'))
  assert.ok(errors.some((error) => error.code === 'schema.block-extension.self-connection'))
})

test('author shorthand is normalized without weakening generation, prompt, or output requirements', () => {
  const template = createBlankTemplate('Minimal author input', 'Create a calm study.')
  const authorInput = structuredClone(template) as Record<string, unknown>
  delete authorInput.schema
  const generation = authorInput.generation as Record<string, unknown>
  delete generation.provider
  delete generation.capability
  delete generation.delivery
  ;(authorInput.outputs as Array<Record<string, unknown>>)[0]!.aspectRatio = '16/9'
  ;(authorInput.outputs as Array<Record<string, unknown>>)[1]!.aspectRatio = '0.75'

  const result = normalizeTemplateInput(authorInput) as PromptWorkspaceTemplate

  assert.equal(result.schema, 'prompt-canvas.prompt-workspace-template@2')
  assert.deepEqual(result.generation, template.generation)
  assert.equal(result.outputs[0]?.aspectRatio, '16:9')
  assert.equal(result.outputs[1]?.aspectRatio, '3:4')
})

test('one-character portable ids remain intact through normalization', () => {
  const template = createBlankTemplate('One character id', 'Create a simple study.')
  template.id = 'a'
  template.outputs[0]!.id = 'b'
  const normalized = normalizeTemplateInput(template) as PromptWorkspaceTemplate
  assert.equal(normalized.id, 'a')
  assert.equal(normalized.outputs[0]?.id, 'b')
})

test('workflow graph references are hard validation errors before runtime', () => {
  const template = createBlankTemplate('Branching workflow', 'Create a branching study.')
  template.workflow = {
    mode: 'branching',
    entryStageId: 'brief',
    stages: [
      {
        id: 'brief',
        title: 'Brief',
        kind: 'collect-input',
        instructions: 'Collect the brief.',
        nextStageIds: ['generate', 'review'],
      },
      {
        id: 'generate',
        title: 'Generate',
        kind: 'generate-image',
        instructions: 'Generate the image.',
      },
      {
        id: 'review',
        title: 'Review',
        kind: 'review',
        instructions: 'Review the image.',
      },
    ],
  }
  assert.deepEqual(workflowValidationErrors(template), [])

  template.workflow.stages[0]!.nextStageIds = ['missing']
  const badReference = workflowValidationErrors(template)
  assert.ok(
    badReference.some((error) => error.code === 'schema.workflow.unknown-next-stage'),
  )

  template.workflow.stages[0]!.nextStageIds = ['generate']
  delete template.workflow.entryStageId
  const missingEntry = workflowValidationErrors(template)
  assert.ok(
    missingEntry.some(
      (error) => error.code === 'schema.workflow.branching-entry-stage-required',
    ),
  )
})
