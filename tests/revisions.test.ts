import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDocumentRevision, assertGenerationRevision, nextRevision } from '../src/workspaces/revisions.js'
import { createBlankTemplate } from '../src/library/template-library-core.js'
import { createWorkspaceManifest } from '../src/workspaces/workspace-factory.js'

test('revision increments can distinguish layout-only and generation-relevant changes', () => {
  const manifest = createWorkspaceManifest(createBlankTemplate('Test'))
  const layout = nextRevision(manifest, false, '2026-08-29T01:00:00.000Z')
  assert.equal(layout.documentRevision, 1)
  assert.equal(layout.generationRevision, 0)
  const prompt = nextRevision(layout, true, '2026-08-29T02:00:00.000Z')
  assert.equal(prompt.documentRevision, 2)
  assert.equal(prompt.generationRevision, 1)
  assert.doesNotThrow(() => assertDocumentRevision(prompt, 2))
  assert.doesNotThrow(() => assertGenerationRevision(prompt, 1))
  assert.throws(() => assertDocumentRevision(prompt, 1), /Stale workspace revision/)
})
