import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveGenerationContext } from '../src/workspaces/prompt-resolver.js'
import { createWorkspaceManifest } from '../src/workspaces/workspace-factory.js'
import type { GenerationContext, JsonValue, PromptWorkspaceTemplate } from '../src/workspaces/types.js'

function fixture(): PromptWorkspaceTemplate {
  return {
    schema: 'prompt-canvas.prompt-workspace-template@2', id: 'readiness-test', version: 1,
    title: 'Readiness test', description: 'Checks generation boundaries without constraining creative style.',
    generation: { provider: 'codex', capability: 'image-generation', delivery: 'webmcp-import',
      operations: ['generate', 'variation'], defaultOperation: 'generate' },
    prompt: { body: 'Draw {{subject}}.', variables: [
      { id: 'subject', label: 'Subject', type: 'string', required: true, defaultValue: 'a lantern' },
    ] },
    outputs: [
      { id: 'primary', label: 'Primary', role: 'primary', kind: 'image', operations: ['generate'] },
      { id: 'variations', label: 'Variations', role: 'variation', kind: 'image-set', operations: ['variation'] },
      { id: 'notes', label: 'Notes', role: 'intermediate', kind: 'text' },
    ],
  }
}

function resolve(template = fixture(), values: Record<string, JsonValue> = {}, overrides: {
  targetOutputId?: string
  operation?: 'generate' | 'variation'
  selection?: GenerationContext['selection']
} = {}): GenerationContext {
  const manifest = createWorkspaceManifest(template, values)
  return resolveGenerationContext({ manifest, template, rawPrompt: template.prompt.body,
    controlValues: manifest.controlValues, verifiedAssetTransports: [], requestId: 'generation:test', ...overrides })
}

test('unknown explicit output targets cannot silently redirect generation', () => {
  assert.throws(() => resolve(fixture(), {}, { targetOutputId: 'typo-output' }), /not found/)
})

test('text outputs and slot-incompatible operations fail before generating an image', () => {
  assert.throws(() => resolve(fixture(), {}, { targetOutputId: 'notes' }), /image output/)
  assert.throws(() => resolve(fixture(), {}, { targetOutputId: 'primary', operation: 'variation' }), /output.*does not support/)
  assert.equal(resolve(fixture(), {}, { targetOutputId: 'variations', operation: 'variation' }).targetOutputId, 'variations')
})

test('an omitted target still uses the primary image slot', () => {
  assert.equal(resolve().targetOutputId, 'primary')
})

test('required variables reject blank, null, or empty-array values at generation time', () => {
  for (const value of ['', '  ', null, []]) {
    assert.throws(() => resolve(fixture(), { subject: value }), /Required.*Subject/)
  }
})

test('false and zero are present values, not missing required inputs', () => {
  const template = fixture()
  template.prompt.variables = [
    { id: 'enabled', label: 'Enabled', type: 'boolean', required: true, defaultValue: false },
    { id: 'count', label: 'Count', type: 'integer', required: true, defaultValue: 0 },
  ]
  template.prompt.body = 'Enabled={{enabled}}, count={{count}}.'
  assert.equal(resolve(template).resolvedPrompt, 'Enabled=false, count=0.')
})

test('required variable-bound controls use their target key, not the control ID', () => {
  const template = fixture()
  template.prompt.variables![0].required = false
  template.controls = [{ id: 'subject-control', label: 'Subject control', type: 'text', required: true,
    binding: { mode: 'variable', target: 'subject' } }]
  assert.throws(() => resolve(template, { subject: '' }), /Required.*Subject control/)
  assert.equal(resolve(template, { subject: 'a kite' }).resolvedPrompt, 'Draw a kite.')
})

test('conditionally hidden required controls do not block unrelated creative modes', () => {
  const template = fixture()
  template.controls = [
    { id: 'mode-control', label: 'Mode', type: 'text', defaultValue: 'simple',
      binding: { mode: 'variable', target: 'mode' } },
    { id: 'detail', label: 'Detail', type: 'textarea', required: true,
      binding: { mode: 'agent-context', target: 'detail' },
      visibility: { whenControlId: 'mode-control', operator: 'equals', value: 'detailed' } },
  ]
  assert.doesNotThrow(() => resolve(template))
  assert.throws(() => resolve(template, { mode: 'detailed' }), /Required.*Detail/)
})

test('optional unresolved placeholders stay visible instead of blocking template creativity', () => {
  const template = fixture()
  template.prompt.body += ' Explore {{optional_surprise}}.'
  assert.match(resolve(template).resolvedPrompt, /\{\{optional_surprise\}\}/)
})

test('negative-prompt variables resolve and their expanded length is bounded', () => {
  const template = fixture()
  template.prompt.negativePrompt = 'No {{excluded_detail}}.'
  assert.equal(resolve(template, { excluded_detail: 'watermarks' }).negativePrompt, 'No watermarks.')
  template.limits = { maxResolvedPromptCharacters: 30 }
  assert.throws(() => resolve(template, { excluded_detail: 'x'.repeat(40) }), /Negative prompt exceeds/)
})

test('selected source outputs participate in the generation digest', () => {
  const first = resolve(fixture(), {}, { selection: { assetIds: ['asset:a'], semanticIds: ['primary'] } })
  const second = resolve(fixture(), {}, { selection: { assetIds: ['asset:b'], semanticIds: ['primary'] } })
  assert.ok(first.promptDigest !== second.promptDigest)
})
