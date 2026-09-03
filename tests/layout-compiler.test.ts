import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compileWorkspaceConnections,
  compileWorkspacePanels,
  ensureRequiredBlocks,
} from '../src/workspaces/layout-compiler.js'
import { createWorkspaceManifest } from '../src/workspaces/workspace-factory.js'
import type { PromptWorkspaceTemplate, WorkspaceBlock } from '../src/workspaces/types.js'

function fixture(): PromptWorkspaceTemplate {
  return {
    schema: 'prompt-canvas.prompt-workspace-template@2',
    id: 'compiler-fixture',
    version: 1,
    title: 'Compiler fixture',
    description: 'A small custom-layout compiler fixture.',
    generation: {
      provider: 'codex',
      capability: 'image-generation',
      delivery: 'webmcp-import',
      operations: ['generate'],
      defaultOperation: 'generate',
    },
    prompt: { body: 'Create a clear study.' },
    controls: [
      {
        id: 'audience',
        label: 'Audience',
        type: 'text',
        defaultValue: 'curious readers',
        binding: { mode: 'agent-context', target: 'audience' },
      },
    ],
    references: [
      {
        id: 'style-reference',
        label: 'Optional style reference',
        role: 'style',
        required: false,
        multiple: false,
      },
    ],
    workflow: {
      mode: 'guided',
      stages: [
        {
          id: 'brief',
          title: 'Brief',
          kind: 'collect-input',
          instructions: 'Collect the brief.',
        },
      ],
    },
    outputs: [
      { id: 'primary', label: 'Primary', role: 'primary', kind: 'image' },
      { id: 'detail', label: 'Detail', role: 'comparison', kind: 'image' },
    ],
  }
}

test('custom layouts retain authored blocks and append missing semantic panels', () => {
  const template = fixture()
  const authored: WorkspaceBlock[] = [
    { id: 'authored-note', type: 'notes', title: 'Keep me', content: 'Custom placement' },
    { id: 'primary-view', type: 'output', sourceId: 'primary', title: 'Authored primary' },
  ]

  const result = ensureRequiredBlocks(template, authored)

  assert.deepEqual(result.slice(0, authored.length), authored)
  assert.equal(result.filter((block) => block.type === 'prompt').length, 1)
  assert.equal(result.filter((block) => block.type === 'controls').length, 1)
  assert.equal(result.filter((block) => block.type === 'references').length, 1)
  assert.equal(result.filter((block) => block.type === 'workflow').length, 1)
  assert.equal(
    result.filter(
      (block) =>
        (block.type === 'output' || block.type === 'variations') && block.sourceId === 'primary',
    ).length,
    1,
  )
  assert.equal(
    result.filter(
      (block) =>
        (block.type === 'output' || block.type === 'variations') && block.sourceId === 'detail',
    ).length,
    1,
  )
  assert.equal(result.at(-1)?.sourceId, 'detail')
})

test('a negative-only authored prompt block cannot hide the editable prompt body', () => {
  const template = fixture()
  const result = ensureRequiredBlocks(template, [
    { id: 'avoid', type: 'prompt', 'x-promptPart': 'negative' },
  ])

  assert.equal(result.filter((block) => block.type === 'prompt').length, 2)
  assert.equal(result.find((block) => block.id === 'prompt-panel')?.['x-promptPart'], 'body')
})

test('an authored presentation can keep prompt details off the opening canvas', () => {
  const template = fixture()
  template['x-presentation'] = { showPromptByDefault: false }
  const result = ensureRequiredBlocks(template, [
    { id: 'brief', type: 'controls', title: 'Brief', 'x-controlIds': ['audience'] },
    { id: 'result', type: 'output', title: 'Result', sourceId: 'primary' },
  ])

  assert.equal(result.some((block) => block.type === 'prompt'), false)
  assert.equal(result.some((block) => block.id === 'brief'), true)
  assert.equal(result.some((block) => block.id === 'result'), true)
})

test('modular blocks can select controls, split prompt surfaces, and declare seeded geometry', () => {
  const template = fixture()
  template.prompt.negativePrompt = 'Avoid clutter.'
  template.controls!.push({
    id: 'mood',
    label: 'Mood',
    type: 'text',
    defaultValue: 'quiet',
    binding: { mode: 'agent-context', target: 'mood' },
  })
  template.blocks = [
    {
      id: 'subject-card',
      type: 'controls',
      title: 'Subject',
      'x-controlIds': ['audience'],
      'x-geometry': { x: 120, y: 90, w: 240, h: 150 },
    },
    {
      id: 'core-brief-card',
      type: 'prompt',
      title: 'Core direction',
      'x-promptPart': 'body',
      'x-geometry': { x: 500, y: 320, w: 420, h: 260 },
    },
    {
      id: 'negative-prompt-card',
      type: 'prompt',
      title: 'Avoid',
      'x-promptPart': 'negative',
      'x-geometry': { x: 120, y: 320, w: 300, h: 180 },
    },
    { id: 'primary-view', type: 'output', sourceId: 'primary', title: 'Generated image' },
  ]

  const panels = compileWorkspacePanels(createWorkspaceManifest(template))
  const subject = panels.find((panel) => panel.semanticId === 'subject-card')
  const body = panels.find((panel) => panel.semanticId === 'core-brief-card')
  const negative = panels.find((panel) => panel.semanticId === 'negative-prompt-card')
  const additional = panels.find((panel) => panel.semanticId === 'controls-panel')

  assert.deepEqual(
    { x: subject?.x, y: subject?.y, w: subject?.w, h: subject?.h },
    { x: 120, y: 90, w: 240, h: 150 },
  )
  assert.deepEqual(
    subject?.payload.kind === 'controls' ? subject.payload.controls.map((control) => control.id) : [],
    ['audience'],
  )
  assert.equal(body?.payload.kind === 'prompt' ? body.payload.displayPart : undefined, 'body')
  assert.equal(negative?.payload.kind === 'prompt' ? negative.payload.displayPart : undefined, 'negative')
  assert.deepEqual(
    additional?.payload.kind === 'controls'
      ? additional.payload.controls.map((control) => control.id)
      : [],
    ['mood'],
  )
})

test('directed block relationships compile as a deduplicated workflow graph', () => {
  const template = fixture()
  template.blocks = [
    { id: 'prompt-card', type: 'prompt', 'x-connectTo': 'primary-view' },
    { id: 'controls-card', type: 'controls', 'x-connectTo': ['primary-view', 'primary-view'] },
    { id: 'primary-view', type: 'output', sourceId: 'primary', 'x-connectTo': 'detail-view' },
    { id: 'detail-view', type: 'output', sourceId: 'detail' },
  ]

  assert.deepEqual(compileWorkspaceConnections(createWorkspaceManifest(template)), [
    { sourceSemanticId: 'prompt-card', targetSemanticId: 'primary-view' },
    { sourceSemanticId: 'controls-card', targetSemanticId: 'primary-view' },
    { sourceSemanticId: 'primary-view', targetSemanticId: 'detail-view' },
  ])
})

test('a compatible current template supplies presentation connections to older workspace snapshots', () => {
  const snapshotTemplate = fixture()
  snapshotTemplate.blocks = [
    { id: 'prompt-card', type: 'prompt' },
    { id: 'primary-view', type: 'output', sourceId: 'primary' },
  ]
  const currentTemplate = structuredClone(snapshotTemplate)
  currentTemplate.blocks![0]['x-connectTo'] = 'primary-view'

  assert.deepEqual(
    compileWorkspaceConnections(createWorkspaceManifest(snapshotTemplate), currentTemplate),
    [{ sourceSemanticId: 'prompt-card', targetSemanticId: 'primary-view' }],
  )

  currentTemplate.version += 1
  assert.deepEqual(
    compileWorkspaceConnections(createWorkspaceManifest(snapshotTemplate), currentTemplate),
    [],
  )
})
