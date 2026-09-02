import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveOutputAsset, resolveOutputSelection } from '../src/workspaces/output-state.js'
import type { OutputPanelPayload } from '../src/workspaces/types.js'

const own = { workspaceId: 'workspace:a', semanticId: 'primary', assetIds: ['asset:a'] }
const foreign = { workspaceId: 'workspace:b', semanticId: 'other-primary', assetIds: ['asset:b'] }

test('an implicit selection from another page is excluded from the requested workspace', () => {
  assert.equal(resolveOutputSelection({ workspaceId: 'workspace:a', allowedAssetIds: ['asset:a'], selectedPanels: [foreign] }), null)
})

test('explicit foreign or nonexistent asset IDs are rejected', () => {
  assert.throws(() => resolveOutputSelection({ workspaceId: 'workspace:a', allowedAssetIds: ['asset:a'],
    selectedPanels: [], requestedAssetIds: ['asset:b'] }), /outside the requested workspace/)
})

test('own selection is deduplicated and foreign semantic identities are omitted', () => {
  assert.deepEqual(resolveOutputSelection({ workspaceId: 'workspace:a', allowedAssetIds: ['asset:a'],
    selectedPanels: [own, foreign, own] }), { assetIds: ['asset:a'], semanticIds: ['primary'] })
})

test('an explicit empty source selection is not replaced with implicit assets', () => {
  assert.deepEqual(resolveOutputSelection({ workspaceId: 'workspace:a', allowedAssetIds: ['asset:a'],
    selectedPanels: [own], requestedAssetIds: [] }), { assetIds: [], semanticIds: ['primary'] })
})

function output(): OutputPanelPayload {
  return { kind: 'output', slot: { id: 'primary', label: 'Primary', role: 'primary', kind: 'image' },
    assetIds: ['asset:a', 'asset:b'], promotedAssetId: 'asset:a',
    compareAssetIds: ['asset:a', 'asset:b'], labels: { 'asset:a': 'First output' } }
}

test('archiving clears promotion and comparison without destroying the source payload', () => {
  const original = output()
  const archived = archiveOutputAsset(original, 'asset:a')
  assert.deepEqual(archived.assetIds, ['asset:b'])
  assert.deepEqual(archived.archivedAssetIds, ['asset:a'])
  assert.deepEqual(archived.compareAssetIds, ['asset:b'])
  assert.equal(archived.promotedAssetId, undefined)
  assert.equal(archived.labels?.['asset:a'], 'First output')
  assert.equal(original.promotedAssetId, 'asset:a')
  assert.deepEqual(original.assetIds, ['asset:a', 'asset:b'])
})

test('an archived asset cannot remain active in another promoted/variation slot', () => {
  const primary = output()
  const variation: OutputPanelPayload = { ...output(), kind: 'variations', slot: { id: 'variations', label: 'Variations', role: 'variation', kind: 'image-set' } }
  const updated = [primary, variation].map((payload) => archiveOutputAsset(payload, 'asset:a'))
  assert.equal(updated.some((payload) => payload.assetIds.includes('asset:a') || payload.promotedAssetId === 'asset:a'), false)
  assert.deepEqual(updated[1].archivedAssetIds, ['asset:a'])
})

test('archival is idempotent and clears compare-only references without inventing ownership', () => {
  const archived = archiveOutputAsset(archiveOutputAsset(output(), 'asset:a'), 'asset:a')
  assert.deepEqual(archived.archivedAssetIds, ['asset:a'])
  const compareOnly = { ...output(), assetIds: ['asset:b'], promotedAssetId: 'asset:b' }
  const next = archiveOutputAsset(compareOnly, 'asset:a')
  assert.equal(next.archivedAssetIds, undefined)
  assert.equal(next.promotedAssetId, 'asset:b')
  assert.deepEqual(next.compareAssetIds, ['asset:b'])
})
