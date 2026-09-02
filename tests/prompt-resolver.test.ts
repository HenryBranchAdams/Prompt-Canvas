import assert from 'node:assert/strict'
import test from 'node:test'
import {
  interpolatePrompt,
  initialControlValues,
  resolveGenerationContext,
} from '../src/workspaces/prompt-resolver.js'
import { createWorkspaceManifest } from '../src/workspaces/workspace-factory.js'
import type { AssetTransportKind, PromptWorkspaceTemplate } from '../src/workspaces/types.js'

const template: PromptWorkspaceTemplate = {
  schema: 'prompt-canvas.prompt-workspace-template@2',
  id: 'test-template',
  version: 1,
  title: 'Test template',
  description: 'A compact test fixture for prompt resolution.',
  generation: {
    provider: 'codex',
    capability: 'image-generation',
    delivery: 'webmcp-import',
    operations: ['generate', 'variation'],
    defaultOperation: 'generate',
    defaultVariationCount: 4,
    preferredMimeTypes: ['image/png'],
  },
  prompt: {
    body: 'Create {{subject}} in {{palette}}.',
    negativePrompt: 'No watermark.',
    variables: [
      { id: 'subject', label: 'Subject', type: 'string', defaultValue: 'a quiet harbor' },
      { id: 'palette', label: 'Palette', type: 'string', defaultValue: 'mist blue' },
    ],
  },
  controls: [
    {
      id: 'subject-control',
      label: 'Subject',
      type: 'text',
      defaultValue: 'a mountain cabin',
      binding: { mode: 'variable', target: 'subject' },
    },
    {
      id: 'aspect',
      label: 'Aspect ratio',
      type: 'aspect-ratio',
      defaultValue: '3:4',
      binding: { mode: 'generation', target: 'aspectRatio' },
    },
  ],
  outputs: [
    { id: 'primary', label: 'Primary', role: 'primary', kind: 'image', count: 1 },
    { id: 'variations', label: 'Variations', role: 'variation', kind: 'image-set', count: 4 },
  ],
}

function factualityTemplate(
  mode: 'supplied' | 'conceptual' | 'mixed',
  sourceNotes = 'Lisbon is a coastal Portuguese city with a historic tram network.',
): PromptWorkspaceTemplate {
  const candidate = structuredClone(template)
  candidate.controls = [
    ...(candidate.controls ?? []),
    {
      id: 'factuality-mode',
      label: 'Factuality mode',
      type: 'enum',
      defaultValue: mode,
      options: [
        { label: 'Supplied', value: 'supplied' },
        { label: 'Conceptual', value: 'conceptual' },
        { label: 'Mixed', value: 'mixed' },
      ],
      binding: { mode: 'agent-context', target: 'factuality.mode' },
    },
    {
      id: 'factuality-source-notes',
      label: 'Source notes',
      type: 'textarea',
      defaultValue: sourceNotes,
      binding: { mode: 'agent-context', target: 'factuality.sourceNotes' },
    },
  ]
  return candidate
}

test('interpolatePrompt resolves known values and leaves unknown placeholders visible', () => {
  const result = interpolatePrompt('A {{subject}} under {{weather}}', { subject: 'tram' })
  assert.equal(result.text, 'A tram under {{weather}}')
  assert.deepEqual(result.unresolved, ['weather'])
})

test('generation context resolves one-character variable ids accepted by the template schema', () => {
  const compactTemplate: PromptWorkspaceTemplate = {
    ...template,
    prompt: {
      body: 'Create a {{a}} study.',
      variables: [{ id: 'a', label: 'Approach', type: 'string', defaultValue: 'quiet' }],
    },
    controls: [],
  }
  const manifest = createWorkspaceManifest(compactTemplate, {}, '2026-08-29T00:00:00.000Z')
  const context = resolveGenerationContext({
    manifest,
    template: compactTemplate,
    rawPrompt: compactTemplate.prompt.body,
    controlValues: manifest.controlValues,
    operation: 'generate',
    verifiedAssetTransports: ['data_url'],
    requestId: 'generation:one-character-variable',
  })

  assert.equal(context.resolvedPrompt, 'Create a quiet study.')
  assert.deepEqual(interpolatePrompt('Create a {{a}} study.', {}).unresolved, ['a'])
})

test('initialControlValues lets surfaced control defaults override variable defaults', () => {
  assert.deepEqual(initialControlValues(template), {
    subject: 'a mountain cabin',
    palette: 'mist blue',
    aspect: '3:4',
  })
})

test('resolveGenerationContext produces an honest Codex handoff', () => {
  const manifest = createWorkspaceManifest(template, { subject: 'Lisbon tram' }, '2026-08-29T00:00:00.000Z')
  const context = resolveGenerationContext({
    manifest,
    template,
    rawPrompt: template.prompt.body,
    controlValues: manifest.controlValues,
    operation: 'variation',
    targetOutputId: 'variations',
    chatDirection: 'Keep the palette cooler and preserve more negative space.',
    verifiedAssetTransports: ['data_url'],
    requestId: 'generation:test',
  })
  assert.equal(context.resolvedPrompt, 'Create Lisbon tram in mist blue.')
  assert.equal(context.outputRequirements.aspectRatio, '3:4')
  assert.equal(context.outputRequirements.requestedCount, 4)
  assert.equal(context.operation, 'variation')
  assert.equal(
    context.controlContext.chatDirection,
    'Keep the palette cooler and preserve more negative space.',
  )
  assert.match(context.hostInstruction, /Codex native image generation/)
})

test('chat direction participates in the prompt digest', () => {
  const manifest = createWorkspaceManifest(template)
  const base = {
    manifest,
    template,
    rawPrompt: template.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'] as AssetTransportKind[],
  }
  const cooler = resolveGenerationContext({
    ...base,
    requestId: 'generation:cooler',
    chatDirection: 'Make the palette cooler.',
  })
  const warmer = resolveGenerationContext({
    ...base,
    requestId: 'generation:warmer',
    chatDirection: 'Make the palette warmer.',
  })
  assert.ok(cooler.promptDigest !== warmer.promptDigest)
})

test('unsupported operations are rejected instead of silently rewritten', () => {
  const manifest = createWorkspaceManifest(template)
  assert.throws(
    () =>
      resolveGenerationContext({
        manifest,
        template,
        rawPrompt: template.prompt.body,
        controlValues: manifest.controlValues,
        operation: 'upscale',
        verifiedAssetTransports: ['data_url'],
        requestId: 'generation:test',
      }),
    /not supported/,
  )
})

test('generation defaults negotiate against the target output slot', () => {
  const candidate = structuredClone(template)
  candidate.generation.operations = ['generate', 'edit', 'upscale']
  candidate.generation.defaultOperation = 'edit'
  candidate.outputs = [
    {
      id: 'primary',
      label: 'Primary',
      role: 'primary',
      kind: 'image',
      operations: ['edit', 'upscale'],
    },
    {
      id: 'secondary',
      label: 'Secondary',
      role: 'comparison',
      kind: 'image',
      operations: ['generate'],
    },
  ]
  const manifest = createWorkspaceManifest(candidate)
  const base = {
    manifest,
    template: candidate,
    rawPrompt: candidate.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'] as AssetTransportKind[],
  }

  const primary = resolveGenerationContext({
    ...base,
    targetOutputId: 'primary',
    requestId: 'request-primary-default',
  })
  const secondary = resolveGenerationContext({
    ...base,
    targetOutputId: 'secondary',
    requestId: 'request-secondary-default',
  })

  assert.equal(primary.operation, 'edit')
  assert.equal(secondary.operation, 'generate')
  assert.throws(
    () =>
      resolveGenerationContext({
        ...base,
        targetOutputId: 'secondary',
        operation: 'edit',
        requestId: 'request-secondary-edit',
      }),
    /does not support operation/i,
  )
  assert.throws(
    () =>
      resolveGenerationContext({
        ...base,
        targetOutputId: 'missing-output',
        requestId: 'request-missing-output',
      }),
    /output “missing-output” was not found/i,
  )
})

test('workflow status and active stage instructions are carried in control context', () => {
  const candidate = structuredClone(template)
  candidate.workflow = {
    mode: 'guided',
    entryStageId: 'brief',
    stages: [
      {
        id: 'brief',
        title: 'Gather the brief',
        kind: 'collect-input',
        instructions: 'Collect the decisions that define the image.',
      },
      {
        id: 'generate',
        title: 'Generate the image',
        kind: 'generate-image',
        instructions: 'Use the approved brief to make the image.',
      },
    ],
  }
  const manifest = createWorkspaceManifest(candidate)
  const base = {
    manifest,
    template: candidate,
    rawPrompt: candidate.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'] as AssetTransportKind[],
  }

  const brief = resolveGenerationContext({
    ...base,
    workflowStatuses: { brief: 'active', generate: 'not-started' },
    requestId: 'request-workflow-brief',
  })
  const generation = resolveGenerationContext({
    ...base,
    workflowStatuses: { brief: 'complete', generate: 'active' },
    requestId: 'request-workflow-generate',
  })

  assert.deepEqual(brief.controlContext.workflow, {
    mode: 'guided',
    statuses: { brief: 'active', generate: 'not-started' },
    activeStageId: 'brief',
    activeStageInstructions: 'Collect the decisions that define the image.',
  })
  assert.deepEqual(generation.controlContext.workflow, {
    mode: 'guided',
    statuses: { brief: 'complete', generate: 'active' },
    activeStageId: 'generate',
    activeStageInstructions: 'Use the approved brief to make the image.',
  })
  assert.ok(brief.promptDigest !== generation.promptDigest)
})

test('templates without workflows keep the existing control context shape', () => {
  const manifest = createWorkspaceManifest(template)
  const context = resolveGenerationContext({
    manifest,
    template,
    rawPrompt: template.prompt.body,
    controlValues: manifest.controlValues,
    workflowStatuses: { imaginary: 'active' },
    verifiedAssetTransports: ['data_url'],
    requestId: 'request-no-workflow',
  })
  assert.equal('workflow' in context.controlContext, false)
})

test('active workflow instructions fail clearly at the context boundary', () => {
  const candidate = structuredClone(template)
  candidate.workflow = {
    mode: 'single-stage',
    stages: [
      {
        id: 'long-stage',
        title: 'Long stage',
        kind: 'custom',
        instructions: 'x'.repeat(20_001),
      },
    ],
  }
  const manifest = createWorkspaceManifest(candidate)
  assert.throws(
    () =>
      resolveGenerationContext({
        manifest,
        template: candidate,
        rawPrompt: candidate.prompt.body,
        controlValues: manifest.controlValues,
        workflowStatuses: { 'long-stage': 'active' },
        verifiedAssetTransports: ['data_url'],
        requestId: 'request-workflow-too-long',
      }),
    /active workflow stage instructions exceed the 20000-character limit/i,
  )
})

test('required reference slots block generation until populated', () => {
  const candidate = structuredClone(template)
  candidate.references = [
    {
      id: 'source',
      label: 'Source image',
      role: 'source-photo',
      required: true,
      acceptedMimeTypes: ['image/png'],
    },
  ]
  const manifest = createWorkspaceManifest(candidate, {}, '2026-08-29T12:00:00.000Z')
  assert.throws(
    () =>
      resolveGenerationContext({
        manifest,
        template: candidate,
        rawPrompt: candidate.prompt.body,
        controlValues: manifest.controlValues,
        references: [],
        verifiedAssetTransports: ['data_url'],
        requestId: 'request-required-reference',
      }),
    /requires at least 1 image/,
  )
})

test('resolved prompts respect the template character bound', () => {
  const candidate = structuredClone(template)
  candidate.limits = { maxResolvedPromptCharacters: 16 }
  const manifest = createWorkspaceManifest(candidate, {}, '2026-08-29T12:00:00.000Z')
  assert.throws(
    () =>
      resolveGenerationContext({
        manifest,
        template: candidate,
        rawPrompt: 'This prompt is intentionally longer than sixteen characters.',
        controlValues: manifest.controlValues,
        verifiedAssetTransports: ['data_url'],
        requestId: 'request-too-long',
      }),
    /character workspace limit/,
  )
})

test('factuality supplied mode carries attributed user assertions in a structured context', () => {
  const candidate = factualityTemplate('supplied')
  const manifest = createWorkspaceManifest(candidate)
  const context = resolveGenerationContext({
    manifest,
    template: candidate,
    rawPrompt: candidate.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'],
    requestId: 'request-factuality-supplied',
  })

  assert.deepEqual(context.factuality, {
    mode: 'supplied',
    sourceNotes: 'Lisbon is a coastal Portuguese city with a historic tram network.',
    suppliedClaims: 'Lisbon is a coastal Portuguese city with a historic tram network.',
    creativeInterpretation: null,
  })
  assert.match(context.hostInstruction, /supplied/i)
  assert.match(context.hostInstruction, /not independently verified facts/i)
  assert.match(context.hostInstruction, /not proof of accuracy/i)
})

test('factuality supplied mode fails closed when source notes are missing', () => {
  const candidate = factualityTemplate('supplied', '')
  const manifest = createWorkspaceManifest(candidate)
  assert.throws(
    () =>
      resolveGenerationContext({
        manifest,
        template: candidate,
        rawPrompt: candidate.prompt.body,
        controlValues: manifest.controlValues,
        verifiedAssetTransports: ['data_url'],
        requestId: 'request-factuality-no-notes',
      }),
    /supplied.*sourceNotes/i,
  )
})

test('factuality source notes fail closed instead of being silently truncated', () => {
  const candidate = factualityTemplate('mixed', 'x'.repeat(20_001))
  const manifest = createWorkspaceManifest(candidate)
  assert.throws(
    () =>
      resolveGenerationContext({
        manifest,
        template: candidate,
        rawPrompt: candidate.prompt.body,
        controlValues: manifest.controlValues,
        verifiedAssetTransports: ['data_url'],
        requestId: 'request-factuality-over-limit',
      }),
    /source notes exceed the 20000-character limit/i,
  )
})

test('factuality conceptual mode labels interpretation as speculation', () => {
  const candidate = factualityTemplate('conceptual')
  const manifest = createWorkspaceManifest(candidate)
  const context = resolveGenerationContext({
    manifest,
    template: candidate,
    rawPrompt: candidate.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'],
    requestId: 'request-factuality-conceptual',
  })

  assert.equal(context.factuality?.mode, 'conceptual')
  assert.equal(context.factuality?.suppliedClaims, null)
  assert.match(context.factuality?.creativeInterpretation ?? '', /Create a mountain cabin/)
  assert.match(context.hostInstruction, /speculative/i)
  assert.match(context.hostInstruction, /label/i)
})

test('factuality mixed mode separates supplied claims from creative interpretation', () => {
  const candidate = factualityTemplate('mixed')
  const manifest = createWorkspaceManifest(candidate)
  const context = resolveGenerationContext({
    manifest,
    template: candidate,
    rawPrompt: candidate.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'],
    requestId: 'request-factuality-mixed',
  })

  assert.equal(context.factuality?.mode, 'mixed')
  assert.equal(
    context.factuality?.suppliedClaims,
    'Lisbon is a coastal Portuguese city with a historic tram network.',
  )
  assert.match(context.factuality?.creativeInterpretation ?? '', /Create a mountain cabin/)
  assert.match(context.hostInstruction, /separate/i)
  assert.match(context.hostInstruction, /creative interpretation/i)

  const alternate = factualityTemplate('mixed', 'Only the tram route is supplied.')
  const alternateManifest = createWorkspaceManifest(alternate)
  const alternateContext = resolveGenerationContext({
    manifest: alternateManifest,
    template: alternate,
    rawPrompt: alternate.prompt.body,
    controlValues: alternateManifest.controlValues,
    verifiedAssetTransports: ['data_url'],
    requestId: 'request-factuality-mixed-alternate',
  })
  assert.ok(context.promptDigest !== alternateContext.promptDigest)
})

test('templates without factuality bindings remain unrestricted', () => {
  const manifest = createWorkspaceManifest(template)
  const context = resolveGenerationContext({
    manifest,
    template,
    rawPrompt: template.prompt.body,
    controlValues: manifest.controlValues,
    verifiedAssetTransports: ['data_url'],
    requestId: 'request-no-factuality',
  })
  assert.equal(context.factuality, undefined)
})
