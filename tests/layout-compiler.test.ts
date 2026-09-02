import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureRequiredBlocks } from '../src/workspaces/layout-compiler.js'
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
