import assert from 'node:assert/strict'
import test from 'node:test'
import { searchTemplates } from '../src/workspaces/template-search.js'
import type { PromptWorkspaceTemplate, TemplateManifestEntry } from '../src/workspaces/types.js'

function record(id: string, title: string, family: TemplateManifestEntry['family'], prompt: string) {
  const entry: TemplateManifestEntry = {
    id,
    path: `${id}.yaml`,
    title,
    description: title,
    category: 'test',
    family,
    operations: ['generate'],
    capabilities: ['text-to-image'],
    featured: false,
    order: 1,
  }
  const template: PromptWorkspaceTemplate = {
    schema: 'prompt-canvas.prompt-workspace-template@2',
    id,
    version: 1,
    title,
    description: title,
    generation: {
      provider: 'codex',
      capability: 'image-generation',
      delivery: 'webmcp-import',
      operations: ['generate'],
    },
    prompt: { body: prompt },
    outputs: [{ id: 'primary', label: 'Primary', role: 'primary', kind: 'image' }],
  }
  return { entry, template }
}

test('search combines free text and family filters', () => {
  const records = [
    record('watercolor', 'Watercolor study', 'lightweight', 'Airy pigment drift'),
    record('poster', 'City poster', 'composition-first', 'Editorial skyline composition'),
  ]
  assert.deepEqual(searchTemplates(records, 'skyline').map(({ entry }) => entry.id), ['poster'])
  assert.deepEqual(searchTemplates(records, '', { family: 'lightweight' }).map(({ entry }) => entry.id), ['watercolor'])
})

test('search indexes ordinary-language discovery aliases', () => {
  const background = record(
    'change-background',
    'Change the background',
    'reference-transformation',
    'Replace only the environment.',
  )
  background.template['x-discovery'] = {
    intentAliases: ['put me somewhere else', 'replace room'],
  }

  assert.deepEqual(
    searchTemplates([background], 'put me somewhere else').map(({ entry }) => entry.id),
    ['change-background'],
  )
})
