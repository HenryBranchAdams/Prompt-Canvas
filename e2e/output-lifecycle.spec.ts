import { expect, test, type Page } from '@playwright/test'
import { webmcpCatalog } from '../src/generated/webmcpCatalog'

type Tool = { execute(input: unknown): Promise<unknown> }
type Registry = { __lifecycleTools: Record<string, Tool> }
type Snapshot = {
  workspace: { workspaceId: string; generationState: string }
  revision: number
  outputs: Array<{ assetIds: string[]; promotedAssetId: string | null; archivedAssetIds: string[] }>
}

async function invoke<T>(page: Page, name: string, input: unknown): Promise<T> {
  return page.evaluate(async ({ name, input }) => {
    return await (window as unknown as Registry).__lifecycleTools[name].execute(input) as T
  }, { name, input })
}

test('archive promoted outputs atomically, undo, and reject foreign workspace sources', async ({ page }) => {
  await page.addInitScript((expectedToolNames: string[]) => {
    const tools: Record<string, Tool> = {}
    Object.defineProperty(window, '__lifecycleTools', { value: tools, configurable: true })
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool: Tool & { name: string }) { tools[tool.name] = tool; return Promise.resolve() },
    } })
    Object.defineProperty(window, '__promptCanvasExpectedToolNames', {
      configurable: true,
      value: expectedToolNames,
    })
  }, webmcpCatalog.tools.map((tool) => tool.name))
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () => Object.keys((window as unknown as Registry).__lifecycleTools).length ===
      (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  await invoke(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'template', templateId: 'create-from-words', values: {} },
    openAfterCreate: true,
  })
  const initial = await invoke<Snapshot>(page, 'prompt_canvas_inspect', {})
  const workspaceId = initial.workspace.workspaceId
  const images = await page.evaluate(() => {
    const makeImage = (color: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = 2
      canvas.height = 2
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas context is unavailable.')
      context.fillStyle = color
      context.fillRect(0, 0, 2, 2)
      return canvas.toDataURL('image/png')
    }
    return { parent: makeImage('#0044ff'), variation: makeImage('#ff4400') }
  })
  const parentContext = await invoke<{
    requestId: string
    generationRevision: number
    promptDigest: string
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId,
    operation: 'generate',
    outputSlotId: 'primary',
  })
  const parent = await invoke<{ assetIds: string[] }>(page, 'prompt_canvas_add_generated_asset', {
    workspaceId,
    requestId: parentContext.requestId,
    generationRevision: parentContext.generationRevision,
    assets: [{
      source: { kind: 'data_url', dataUrl: images.parent },
      mimeType: 'image/png',
      outputSlotId: 'primary',
      operation: 'generate',
      promptDigest: parentContext.promptDigest,
      label: 'Variation source image',
    }],
  })
  const parentAssetId = parent.assetIds[0]
  const context = await invoke<{ requestId: string; generationRevision: number; promptDigest: string }>(page,
    'prompt_canvas_get_generation_context', {
      workspaceId,
      operation: 'variation',
      outputSlotId: 'variations',
      selectedOutputIds: [parentAssetId],
    })
  const imported = await invoke<{ assetIds: string[]; revision: number }>(page, 'prompt_canvas_add_generated_asset', {
    workspaceId, requestId: context.requestId, generationRevision: context.generationRevision,
    assets: [{ source: { kind: 'data_url', dataUrl: images.variation },
      mimeType: 'image/png', outputSlotId: 'variations', operation: 'variation',
      parentAssetIds: [parentAssetId], promptDigest: context.promptDigest,
      label: 'Archive regression image' }],
  })
  expect(imported.assetIds).toHaveLength(1)
  const assetId = imported.assetIds[0]
  const promoted = await invoke<{ revision: number }>(page, 'prompt_canvas_manage_outputs', {
    workspaceId, expectedRevision: imported.revision, operations: [{ op: 'promote', assetId }],
  })
  const before = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
  expect(before.outputs.filter((output) => output.assetIds.includes(assetId))).toHaveLength(2)

  await expect(invoke(page, 'prompt_canvas_manage_outputs', {
    workspaceId,
    expectedRevision: before.revision,
    operations: [{ op: 'delete', assetIds: ['asset:not-present'] }],
  })).rejects.toThrow(/was not found/)
  expect(await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })).toEqual(before)

  // A later failure in a batch must roll back the earlier archive operation.
  await expect(invoke(page, 'prompt_canvas_manage_outputs', { workspaceId, expectedRevision: promoted.revision,
    operations: [{ op: 'archive', assetIds: [assetId] }, { op: 'promote', assetId: 'asset:not-present' }],
  })).rejects.toThrow(/was not found/)
  const rolledBack = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
  expect(rolledBack.revision).toBe(before.revision)
  expect(rolledBack.outputs).toEqual(before.outputs)
  await expect(page.locator('.tl-error-boundary')).toHaveCount(0)

  await invoke(page, 'prompt_canvas_manage_outputs', { workspaceId, expectedRevision: rolledBack.revision,
    operations: [{ op: 'archive', assetIds: [assetId, parentAssetId] }],
  })
  const archived = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
  expect(archived.outputs.every((output) => !output.assetIds.includes(assetId) && output.promotedAssetId !== assetId)).toBe(true)
  expect(archived.outputs.some((output) => output.archivedAssetIds.includes(assetId))).toBe(true)
  expect(archived.workspace.generationState).toBe('empty')
  await expect(page.locator('img[alt="Archive regression image"]')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => {
    const snapshot = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
    return snapshot.outputs.filter((output) => output.assetIds.includes(assetId)).length
  }).toBe(2)
  const restored = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
  expect(restored.outputs.some((output) => output.promotedAssetId === assetId)).toBe(true)
  expect(restored.workspace.generationState).toBe('complete')
  await expect(page.locator('img[alt="Archive regression image"]')).toHaveCount(1)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => {
    const snapshot = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
    return snapshot.outputs.every((output) => !output.assetIds.includes(assetId) && output.promotedAssetId !== assetId)
  }).toBe(true)
  const redone = await invoke<Snapshot>(page, 'prompt_canvas_inspect', { workspaceId })
  expect(redone.workspace.generationState).toBe('empty')
  await expect(page.locator('img[alt="Archive regression image"]')).toHaveCount(0)

  const second = await invoke<{ workspaceId: string }>(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'blank', title: 'Independent workspace', prompt: 'Draw a lantern.' },
  })
  await expect(invoke(page, 'prompt_canvas_get_generation_context', {
    workspaceId: second.workspaceId, operation: 'generate', selectedOutputIds: [assetId],
  })).rejects.toThrow(/outside the requested workspace/)
})
