import { expect, test, type Page } from '@playwright/test'
import { webmcpCatalog } from '../src/generated/webmcpCatalog'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const AGENT_TEMPLATE = {
  schema: 'prompt-canvas.prompt-workspace-template@2',
  id: 'agent-authored-light-study',
  version: 1,
  title: 'Agent-authored Light Study',
  description: 'A deliberately compact prompt workspace authored through WebMCP.',
  status: 'draft',
  generation: {
    provider: 'codex',
    capability: 'image-generation',
    delivery: 'webmcp-import',
    operations: ['generate', 'variation'],
    defaultOperation: 'generate',
    defaultVariationCount: 3,
    preferredMimeTypes: ['image/png', 'image/webp'],
  },
  prompt: {
    title: 'Light study',
    body: 'Create a quiet editorial light study of {{subject}} with {{mood}} atmosphere, {{camera_note}}, and generous negative space.',
    'x-prompt-provenance': {
      sourceRecord: 'agent-source-123',
    },
    variables: [
      {
        id: 'subject',
        label: 'Subject',
        type: 'string',
        required: true,
        defaultValue: 'a single ceramic vessel',
      },
      {
        id: 'mood',
        label: 'Mood',
        type: 'string',
        required: false,
        defaultValue: 'soft morning',
      },
      {
        id: 'camera_note',
        label: 'Camera note',
        type: 'string',
        required: false,
        defaultValue: 'eye-level medium view',
      },
    ],
  },
  controls: [
    {
      id: 'subject',
      label: 'Subject',
      type: 'text',
      required: true,
      defaultValue: 'a single ceramic vessel',
      binding: { mode: 'variable', target: 'subject' },
    },
    {
      id: 'mood',
      label: 'Mood',
      type: 'combobox',
      required: false,
      defaultValue: 'soft morning',
      allowCustom: true,
      options: [
        { label: 'Soft morning', value: 'soft morning' },
        { label: 'Overcast studio', value: 'overcast studio' },
      ],
      binding: { mode: 'variable', target: 'mood' },
    },
  ],
  outputs: [
    { id: 'primary', label: 'Primary image', role: 'primary', kind: 'image', count: 1 },
    { id: 'variations', label: 'Variations', role: 'variation', kind: 'image', count: 3 },
  ],
  compatibility: { minimumAppVersion: '0.1.0', templateFamily: 'open' },
  capabilities: ['text-to-image'],
  source: {
    kind: 'x-bookmark',
    title: 'Reviewed source prompt',
    creator: 'Source creator',
    url: 'https://example.com/reviewed-source',
    accessedAt: '2026-08-29',
    promptUsage: 'adapted',
    notes: 'Reviewed and normalized before runtime use.',
    'x-review': {
      status: 'reviewed',
    },
  },
  'x-agent-note': {
    purpose: 'Proves that inert extension fields do not constrain creative template authorship.',
  },
} as const

const SLOT_ROUTING_TEMPLATE = {
  schema: 'prompt-canvas.prompt-workspace-template@2',
  id: 'slot-routing-workflow',
  version: 1,
  title: 'Slot routing workflow',
  description: 'A focused fixture for output-slot operation negotiation and workflow context.',
  status: 'draft',
  generation: {
    provider: 'codex',
    capability: 'image-generation',
    delivery: 'webmcp-import',
    operations: ['generate', 'edit', 'upscale'],
    defaultOperation: 'edit',
    preferredMimeTypes: ['image/png'],
  },
  prompt: {
    body: 'Create a clear study of a small mechanical object.',
  },
  outputs: [
    {
      id: 'primary',
      label: 'Primary output',
      role: 'primary',
      kind: 'image',
      operations: ['edit', 'upscale'],
    },
    {
      id: 'secondary',
      label: 'Generate-only secondary',
      role: 'comparison',
      kind: 'image',
      operations: ['generate'],
    },
  ],
  workflow: {
    mode: 'guided',
    entryStageId: 'brief',
    stages: [
      {
        id: 'brief',
        title: 'Gather the brief',
        kind: 'collect-input',
        instructions: 'Collect the object and the intended audience.',
      },
      {
        id: 'plan',
        title: 'Plan the explanation',
        kind: 'compose-prompt',
        instructions: 'Choose the clearest visual route through the object.',
      },
    ],
  },
  blocks: [
    { id: 'prompt-block', type: 'prompt', title: 'Prompt', region: 'left', order: 10 },
    { id: 'workflow-block', type: 'workflow', title: 'Workflow', region: 'left', order: 20 },
    { id: 'primary-block', type: 'output', title: 'Primary output', sourceId: 'primary', region: 'right', order: 10 },
    { id: 'secondary-block', type: 'output', title: 'Generate-only secondary', sourceId: 'secondary', region: 'right', order: 20 },
  ],
  compatibility: { minimumAppVersion: '0.1.0', templateFamily: 'open' },
} as const

const FACTUALITY_TEMPLATE = {
  ...AGENT_TEMPLATE,
  id: 'agent-authored-factuality-study',
  title: 'Agent-authored Factuality Study',
  description: 'An opt-in supplied-assertion boundary exercised through registered WebMCP tools.',
  prompt: {
    ...AGENT_TEMPLATE.prompt,
    body: 'Create an educational system illustration using only the supplied assertions for factual claims.',
  },
  controls: [
    ...AGENT_TEMPLATE.controls,
    {
      id: 'factuality-mode',
      label: 'Factuality mode',
      type: 'enum',
      defaultValue: 'supplied',
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
      defaultValue: 'The supplied system has three labeled stages connected in sequence.',
      binding: { mode: 'agent-context', target: 'factuality.sourceNotes' },
    },
  ],
} as const

type RegisteredTool = {
  name: string
  execute(input: unknown): Promise<unknown> | unknown
}

async function installMockWebMcp(page: Page) {
  await page.addInitScript((expectedToolNames: string[]) => {
    const tools: Record<string, RegisteredTool> = {}
    Object.defineProperty(window, '__promptCanvasTools', {
      configurable: true,
      value: tools,
    })
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool) {
          tools[tool.name] = tool
          return Promise.resolve()
        },
      },
    })
    Object.defineProperty(window, '__promptCanvasExpectedToolNames', {
      configurable: true,
      value: expectedToolNames,
    })
  }, webmcpCatalog.tools.map((tool) => tool.name))
}

async function callTool<T>(page: Page, name: string, input: unknown): Promise<T> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const registry = (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
        .__promptCanvasTools
      const tool = registry[toolName]
      if (!tool) throw new Error(`Tool ${toolName} was not registered.`)
      return (await tool.execute(toolInput)) as T
    },
    { toolName: name, toolInput: input },
  )
}

async function createTravelWorkspace(page: Page): Promise<void> {
  await callTool(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'template', templateId: 'travel-poster', values: {} },
    openAfterCreate: true,
  })
}

test('workspace creation remains available beyond forty persisted pages', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )

  // First run no longer pre-creates a project. Forty-one explicit projects prove
  // the prior 40-page tldraw limit remains removed.
  for (let index = 1; index <= 41; index += 1) {
    await callTool(page, 'prompt_canvas_create_workspace', {
      source: {
        kind: 'blank',
        title: `Capacity workspace ${index}`,
        prompt: `Capacity regression workspace ${index}.`,
      },
      openAfterCreate: false,
    })
  }

  await expect(page.getByLabel('Active project').locator('option:not([value=""])')).toHaveCount(41)
})

async function waitForPersistedAsset(
  page: Page,
  recordId: string,
  workspaceId: string,
  revision: number,
) {
  await page.waitForFunction(
    async ({ id, workspace, expectedRevision }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('TLDRAW_DOCUMENT_v2prompt-canvas-document-v1')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })

      try {
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction('records', 'readonly').objectStore('records').getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result)
        })
        const assetPersisted = records.some((record) =>
          Boolean(record) && typeof record === 'object' && (record as { id?: unknown }).id === id)
        const outputPanelPersisted = records.some((record) => {
          if (!record || typeof record !== 'object') return false
          const shape = record as { typeName?: unknown; type?: unknown; props?: unknown }
          return shape.typeName === 'shape' && shape.type === 'prompt-canvas-panel' &&
            JSON.stringify(shape.props).includes(id)
        })
        const pageManifestPersisted = records.some((record) => {
          if (!record || typeof record !== 'object') return false
          const pageRecord = record as {
            typeName?: unknown
            meta?: { promptCanvas?: { workspaceId?: unknown; documentRevision?: unknown } }
          }
          const manifest = pageRecord.meta?.promptCanvas
          return pageRecord.typeName === 'page' && manifest?.workspaceId === workspace &&
            manifest.documentRevision === expectedRevision
        })
        const sync = (window as unknown as {
          tlsync?: {
            diffQueue?: unknown[]
            isPersisting?: boolean
            scheduledPersistTimeout?: unknown
          }
        }).tlsync
        const persistenceIdle = Boolean(sync) && sync!.diffQueue?.length === 0 &&
          sync!.isPersisting === false && !sync!.scheduledPersistTimeout
        return assetPersisted && outputPanelPersisted && pageManifestPersisted && persistenceIdle
      } finally {
        database.close()
      }
    },
    { id: recordId, workspace: workspaceId, expectedRevision: revision },
  )
  await flushTldrawPersistence(page)
}

async function waitForPersistedOutputDeletion(
  page: Page,
  assetId: string,
  workspaceId: string,
  revision: number,
) {
  await page.waitForFunction(
    async ({ id, workspace, expectedRevision }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('TLDRAW_DOCUMENT_v2prompt-canvas-document-v1')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      try {
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction('records', 'readonly').objectStore('records').getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result)
        })
        const pagePersisted = records.some((record) => {
          if (!record || typeof record !== 'object') return false
          const pageRecord = record as {
            typeName?: unknown
            meta?: { promptCanvas?: { workspaceId?: unknown; documentRevision?: unknown } }
          }
          const manifest = pageRecord.meta?.promptCanvas
          return pageRecord.typeName === 'page' && manifest?.workspaceId === workspace &&
            manifest.documentRevision === expectedRevision
        })
        const outputPayloads = records.flatMap((record) => {
          if (!record || typeof record !== 'object') return []
          const shape = record as { typeName?: unknown; type?: unknown; props?: { payload?: unknown } }
          if (shape.typeName !== 'shape' || shape.type !== 'prompt-canvas-panel' ||
            typeof shape.props?.payload !== 'string') return []
          try {
            const payload = JSON.parse(shape.props.payload) as { kind?: unknown; assetIds?: unknown }
            return payload.kind === 'output' || payload.kind === 'variations' ? [payload] : []
          } catch {
            return []
          }
        })
        const outputsPersisted = outputPayloads.length > 0 && outputPayloads.every(
          (payload) => !Array.isArray(payload.assetIds) || !payload.assetIds.includes(id),
        )
        const sync = (window as unknown as {
          tlsync?: { diffQueue?: unknown[]; isPersisting?: boolean; scheduledPersistTimeout?: unknown }
        }).tlsync
        const persistenceIdle = Boolean(sync) && sync!.diffQueue?.length === 0 &&
          sync!.isPersisting === false && !sync!.scheduledPersistTimeout
        return pagePersisted && outputsPersisted && persistenceIdle
      } finally {
        database.close()
      }
    },
    { id: assetId, workspace: workspaceId, expectedRevision: revision },
  )
  await flushTldrawPersistence(page)
}

async function flushTldrawPersistence(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sync = (window as unknown as {
      tlsync?: {
        persistIfNeeded?: () => void
        db?: { pending?: () => Promise<void> }
      }
    }).tlsync
    if (!sync?.persistIfNeeded || !sync.db?.pending) {
      throw new Error('tldraw local persistence is unavailable.')
    }
    sync.persistIfNeeded()
    await sync.db.pending()
  })
}

async function createNativeSizedPng(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 1024
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context is unavailable.')
    const image = context.createImageData(canvas.width, canvas.height)
    let seed = 0x2f6e2b1
    for (let index = 0; index < image.data.length; index += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      image.data[index] = seed & 0xff
      image.data[index + 1] = (seed >>> 8) & 0xff
      image.data[index + 2] = (seed >>> 16) & 0xff
      image.data[index + 3] = 0xff
    }
    context.putImageData(image, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length < 1_000_000) {
      throw new Error('Native-sized PNG fixture was unexpectedly small.')
    }
    return dataUrl
  })
}

async function readPersistedAssetStorage(page: Page, assetId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TLDRAW_DOCUMENT_v2prompt-canvas-document-v1')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })

    try {
      const transaction = database.transaction(['records', 'assets'], 'readonly')
      const recordRequest = transaction.objectStore('records').get(id)
      const blobRequest = transaction.objectStore('assets').get(id)
      const [record, blob] = await Promise.all([
        new Promise<unknown>((resolve, reject) => {
          recordRequest.onerror = () => reject(recordRequest.error)
          recordRequest.onsuccess = () => resolve(recordRequest.result)
        }),
        new Promise<Blob | undefined>((resolve, reject) => {
          blobRequest.onerror = () => reject(blobRequest.error)
          blobRequest.onsuccess = () => resolve(blobRequest.result as Blob | undefined)
        }),
      ])
      const source = record && typeof record === 'object'
        ? (record as { props?: { src?: unknown } }).props?.src
        : undefined
      return {
        source: typeof source === 'string' ? source : null,
        blobSize: blob?.size ?? 0,
        blobType: blob?.type ?? '',
      }
    } finally {
      database.close()
    }
  }, assetId)
}

test.beforeEach(async ({ page }) => {
  await installMockWebMcp(page)
})

test('Travel Poster renders bound workflow connections that follow cards and survive reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] })
        .__promptCanvasExpectedToolNames.length,
  )
  await createTravelWorkspace(page)

  const inspect = await callTool<{
    workspace: { workspaceId: string }
    revision: number
    elements: Array<{ semanticId: string; x: number; y: number }>
  }>(page, 'prompt_canvas_inspect', { include: ['layout'], maxItems: 200 })
  const subject = inspect.elements.find((element) => element.semanticId === 'subject-card')
  expect(subject).toBeTruthy()

  const arrows = page.locator('[data-shape-type="arrow"]')
  await expect(arrows).toHaveCount(12)
  const beforeRender = await arrows.evaluateAll((elements) =>
    elements.map((element) => `${element.getAttribute('style')}|${element.innerHTML}`),
  )

  const updated = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
    workspaceId: inspect.workspace.workspaceId,
    expectedRevision: inspect.revision,
    operations: [{
      op: 'move_element',
      elementId: 'subject-card',
      x: subject!.x + 40,
      y: subject!.y + 20,
    }],
    reason: 'Verify bound workflow connection movement',
  })
  expect(updated.revision).toBe(inspect.revision + 1)
  await expect.poll(async () =>
    arrows.evaluateAll((elements) =>
      elements.map((element) => `${element.getAttribute('style')}|${element.innerHTML}`),
    ),
  ).not.toEqual(beforeRender)

  await flushTldrawPersistence(page)
  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await expect(page.locator('[data-shape-type="arrow"]')).toHaveCount(12)
  const restored = await callTool<{
    revision: number
    elements: Array<{ semanticId: string; x: number; y: number }>
  }>(page, 'prompt_canvas_inspect', {
    workspaceId: inspect.workspace.workspaceId,
    include: ['layout'],
    maxItems: 200,
  })
  expect(restored.revision).toBe(updated.revision)
  expect(restored.elements.find((element) => element.semanticId === 'subject-card')).toMatchObject({
    x: subject!.x + 40,
    y: subject!.y + 20,
  })
})

test('Codex context, generated-asset import, lineage, and persistence round trip', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )

  const toolNames = await page.evaluate(() =>
    Object.keys(
      (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
        .__promptCanvasTools,
    ).sort(),
  )
  expect(toolNames).toEqual(webmcpCatalog.tools.map((tool) => tool.name).sort())
  expect(toolNames).toContain('prompt_canvas_get_generation_context')
  expect(toolNames).toContain('prompt_canvas_add_generated_asset')
  await createTravelWorkspace(page)

  const inspect = await callTool<{
    workspace: { workspaceId: string }
    revision: number
    generationRevision: number
    verifiedAssetTransports: string[]
    capabilities: { pageTools: string[] }
  }>(page, 'prompt_canvas_inspect', {
    include: ['prompt', 'controls', 'outputs', 'capabilities'],
  })
  expect(inspect.workspace.workspaceId).toBeTruthy()
  expect(inspect.verifiedAssetTransports).toContain('data_url')
  expect(inspect.capabilities.pageTools.sort()).toEqual(toolNames)
  await page.locator('.pc-topbar').getByRole('button', { name: 'Generate with Codex' }).click()
  const closeDialog = page.getByRole('button', { name: 'Close dialog' })
  const continueButton = page.getByRole('button', { name: 'Done' })
  await expect(continueButton).toBeVisible()
  await expect(closeDialog).toBeFocused()
  await closeDialog.press('Shift+Tab')
  await expect(continueButton).toBeFocused()
  await continueButton.press('Tab')
  await expect(closeDialog).toBeFocused()
  const modalLayerZ = await page
    .locator('.pc-modal-layer')
    .evaluate((element) => Number(getComputedStyle(element).zIndex))
  const tldrawStylePanelZ = await page
    .locator('.tlui-style-panel__wrapper')
    .evaluate((element) => Number(getComputedStyle(element).zIndex))
  expect(modalLayerZ).toBeGreaterThan(tldrawStylePanelZ)
  await page.getByRole('button', { name: 'Done' }).click()

  const context = await callTool<{
    requestId: string
    workspaceId: string
    generationRevision: number
    targetOutputId: string
    resolvedPrompt: string
    promptDigest: string
    controlContext: { chatDirection?: string }
    outputRequirements: { aspectRatio: string; requestedCount: number }
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: inspect.workspace.workspaceId,
    operation: 'generate',
    chatDirection: 'Use Lisbon as the city and keep the palette slightly cooler.',
  })
  expect(context.requestId).toMatch(/^genreq_/)
  expect(context.resolvedPrompt).toContain('Lisbon')
  expect(context.controlContext.chatDirection).toBe(
    'Use Lisbon as the city and keep the palette slightly cooler.',
  )
  expect(context.outputRequirements.aspectRatio).toBeTruthy()

  const imported = await callTool<{
    workspaceId: string
    revision: number
    assetIds: string[]
    placements: Array<{ slotId: string; assetId: string; index: number }>
    rejectedAssets: unknown[]
    lineage: unknown[]
  }>(page, 'prompt_canvas_add_generated_asset', {
    workspaceId: context.workspaceId,
    requestId: context.requestId,
    generationRevision: context.generationRevision,
    assets: [
      {
        source: { kind: 'data_url', dataUrl: TINY_PNG },
        mimeType: 'image/png',
        label: 'Codex E2E image',
        outputSlotId: context.targetOutputId,
        operation: 'generate',
        promptDigest: context.promptDigest,
      },
    ],
  })
  expect(imported.assetIds).toHaveLength(1)
  expect(imported.rejectedAssets).toEqual([])
  expect(imported.lineage).toHaveLength(1)
  await expect(page.locator('img[alt="Codex E2E image"]')).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(page.locator('img[alt="Codex E2E image"]')).toBeHidden()
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('img[alt="Codex E2E image"]')).toBeVisible()

  await waitForPersistedAsset(page, imported.assetIds[0], imported.workspaceId, imported.revision)
  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  const afterReload = await callTool<{ revision: number; outputs: Array<{ assetIds: string[] }> }>(
    page,
    'prompt_canvas_inspect',
    { workspaceId: inspect.workspace.workspaceId, include: ['outputs'] },
  )
  expect(afterReload.outputs.flatMap((output) => output.assetIds)).toContain(imported.assetIds[0])
  await expect(page.locator('img[alt="Codex E2E image"]')).toBeVisible()
})

test('native-sized generated assets use durable local asset storage', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  await createTravelWorkspace(page)

  const initial = await callTool<{ workspace: { workspaceId: string } }>(
    page,
    'prompt_canvas_inspect',
    {},
  )
  const context = await callTool<{
    requestId: string
    workspaceId: string
    generationRevision: number
    targetOutputId: string
    promptDigest: string
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: initial.workspace.workspaceId,
    operation: 'generate',
    outputSlotId: 'primary',
  })
  const dataUrl = await createNativeSizedPng(page)
  const imported = await callTool<{ workspaceId: string; revision: number; assetIds: string[] }>(
    page,
    'prompt_canvas_add_generated_asset',
    {
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      generationRevision: context.generationRevision,
      assets: [{
        source: { kind: 'data_url', dataUrl },
        mimeType: 'image/png',
        label: 'Native-sized persistence image',
        outputSlotId: context.targetOutputId,
        operation: 'generate',
        promptDigest: context.promptDigest,
      }],
    },
  )

  expect(imported.assetIds).toHaveLength(1)
  const renderedSource = await page
    .locator('img[alt="Native-sized persistence image"]')
    .getAttribute('src')
  expect(renderedSource).toMatch(/^blob:/)

  await waitForPersistedAsset(page, imported.assetIds[0], imported.workspaceId, imported.revision)
  const persisted = await readPersistedAssetStorage(page, imported.assetIds[0])
  expect(persisted).toEqual({
    source: imported.assetIds[0],
    blobSize: expect.any(Number),
    blobType: 'image/png',
  })
  expect(persisted.blobSize).toBeGreaterThan(1_000_000)

  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  const afterReload = await callTool<{ revision: number; outputs: Array<{ assetIds: string[] }> }>(
    page,
    'prompt_canvas_inspect',
    { workspaceId: imported.workspaceId, include: ['outputs'] },
  )
  expect(afterReload.outputs.flatMap((output) => output.assetIds)).toContain(imported.assetIds[0])
  await expect(page.locator('img[alt="Native-sized persistence image"]')).toBeVisible()

  const deleted = await callTool<{ revision: number }>(page, 'prompt_canvas_manage_outputs', {
    workspaceId: imported.workspaceId,
    expectedRevision: afterReload.revision,
    operations: [{ op: 'delete', assetIds: imported.assetIds }],
  })
  await expect(page.locator('img[alt="Native-sized persistence image"]')).toBeHidden()
  await page.keyboard.press('Control+z')
  await expect(page.locator('img[alt="Native-sized persistence image"]')).toBeVisible()
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('img[alt="Native-sized persistence image"]')).toBeHidden()
  await waitForPersistedOutputDeletion(
    page,
    imported.assetIds[0],
    imported.workspaceId,
    deleted.revision,
  )

  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  await flushTldrawPersistence(page)
  await expect
    .poll(() => readPersistedAssetStorage(page, imported.assetIds[0]), { timeout: 15_000 })
    .toEqual({ source: null, blobSize: 0, blobType: '' })
  const afterCompaction = await callTool<{ revision: number; outputs: Array<{ assetIds: string[] }> }>(
    page,
    'prompt_canvas_inspect',
    { workspaceId: imported.workspaceId, include: ['outputs'] },
  )
  expect(afterCompaction.revision).toBe(deleted.revision)
  expect(afterCompaction.outputs.flatMap((output) => output.assetIds)).not.toContain(imported.assetIds[0])
})

test('native-sized references use durable local asset storage', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )

  const created = await callTool<{ workspaceId: string }>(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'template', templateId: 'character-continuity-kit' },
    openAfterCreate: true,
  })
  const before = await callTool<{ revision: number }>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
  })
  const dataUrl = await createNativeSizedPng(page)
  const updated = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspaceId,
    expectedRevision: before.revision,
    operations: [{
      op: 'attach_reference',
      slotId: 'identity-reference',
      asset: { kind: 'data_url', dataUrl },
      label: 'Native-sized reference image',
    }],
  })
  const inspected = await callTool<{ references: Array<{ assetId: string }> }>(
    page,
    'prompt_canvas_inspect',
    { workspaceId: created.workspaceId, include: ['references'] },
  )
  expect(inspected.references).toHaveLength(1)
  const assetId = inspected.references[0].assetId
  const renderedSource = await page
    .locator('img[alt="Native-sized reference image"]')
    .getAttribute('src')
  expect(renderedSource).toMatch(/^blob:/)

  await waitForPersistedAsset(page, assetId, created.workspaceId, updated.revision)
  const persisted = await readPersistedAssetStorage(page, assetId)
  expect(persisted).toEqual({
    source: assetId,
    blobSize: expect.any(Number),
    blobType: 'image/png',
  })
  expect(persisted.blobSize).toBeGreaterThan(1_000_000)

  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  const afterReload = await callTool<{ references: Array<{ assetId: string }> }>(
    page,
    'prompt_canvas_inspect',
    { workspaceId: created.workspaceId, include: ['references'] },
  )
  expect(afterReload.references.map(({ assetId: id }) => id)).toContain(assetId)
  await expect(page.locator('img[alt="Native-sized reference image"]')).toBeVisible()
})

test('generated asset imports require prepared identity and derived lineage', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  await createTravelWorkspace(page)

  const inspect = await callTool<{ workspace: { workspaceId: string } }>(
    page,
    'prompt_canvas_inspect',
    {},
  )
  const context = await callTool<{
    requestId: string
    workspaceId: string
    generationRevision: number
    targetOutputId: string
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: inspect.workspace.workspaceId,
    operation: 'generate',
  })
  const rejected = await callTool<{
    assetIds: string[]
    rejectedAssets: Array<{ reason: string }>
  }>(page, 'prompt_canvas_add_generated_asset', {
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      generationRevision: context.generationRevision,
      assets: [
        {
          source: { kind: 'data_url', dataUrl: TINY_PNG },
          mimeType: 'image/png',
          outputSlotId: context.targetOutputId,
          operation: 'generate',
        },
      ],
    })
  expect(rejected.assetIds).toEqual([])
  expect(rejected.rejectedAssets[0]?.reason).toMatch(/prompt digest/i)

  const variationContext = await callTool<{
    requestId: string
    workspaceId: string
    generationRevision: number
    targetOutputId: string
    promptDigest: string
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: context.workspaceId,
    operation: 'variation',
    outputSlotId: 'variations',
  })
  const lineageRejected = await callTool<{
    assetIds: string[]
    rejectedAssets: Array<{ reason: string }>
  }>(page, 'prompt_canvas_add_generated_asset', {
      workspaceId: variationContext.workspaceId,
      requestId: variationContext.requestId,
      generationRevision: variationContext.generationRevision,
      assets: [
        {
          source: { kind: 'data_url', dataUrl: TINY_PNG },
          mimeType: 'image/png',
          outputSlotId: variationContext.targetOutputId,
          operation: 'variation',
          promptDigest: variationContext.promptDigest,
        },
      ],
    })
  expect(lineageRejected.assetIds).toEqual([])
  expect(lineageRejected.rejectedAssets[0]?.reason).toMatch(/parent/i)
})

test('Codex can author, validate, instantiate, and save a flexible template', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )

  const validation = await callTool<{
    valid: boolean
    schemaErrors: unknown[]
    compatibilityWarnings: unknown[]
  }>(page, 'prompt_canvas_validate_template', { template: AGENT_TEMPLATE, mode: 'full' })
  expect(validation.valid).toBe(true)
  expect(validation.schemaErrors).toEqual([])

  const created = await callTool<{
    workspaceId: string
    pageId: string
    createdElements: string[]
    warnings: string[]
  }>(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'definition', template: AGENT_TEMPLATE },
    placement: 'new-page',
    openAfterCreate: true,
  })
  expect(created.createdElements).toContain('prompt-panel')
  expect(created.createdElements).toContain('primary-output')
  expect(created.warnings).toEqual([])

  const beforeVariableEdit = await callTool<{ revision: number }>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
  })
  await callTool(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspaceId,
    expectedRevision: beforeVariableEdit.revision,
    operations: [{
      op: 'set_variable',
      variableId: 'camera_note',
      value: 'low-angle close view',
    }],
    reason: 'Preserve a variable that has no mirrored control',
  })

  const saved = await callTool<{
    templateId: string
    version: number
    validation: { valid: boolean }
  }>(page, 'prompt_canvas_save_template', {
    source: { kind: 'workspace', workspaceId: created.workspaceId },
    mode: 'create',
    title: 'Saved Agent-authored Light Study',
  })
  expect(saved.validation.valid).toBe(true)

  const savedTemplate = await callTool<{
    template: {
      source: { title: string; creator: string; promptUsage: string; 'x-review': { status: string } }
      prompt: {
        variables: Array<{ id: string; defaultValue?: unknown }>
        'x-prompt-provenance': { sourceRecord: string }
      }
      'x-agent-note': { purpose: string }
    }
    provenance: {
      title: string
      creator: string
      promptUsage: string
      'x-review': { status: string }
    }
  }>(page, 'prompt_canvas_get_template', { templateId: saved.templateId })
  expect(savedTemplate.template.source).toEqual(AGENT_TEMPLATE.source)
  expect(savedTemplate.template.prompt['x-prompt-provenance']).toEqual(
    AGENT_TEMPLATE.prompt['x-prompt-provenance'],
  )
  expect(
    savedTemplate.template.prompt.variables.find(({ id }) => id === 'camera_note')?.defaultValue,
  ).toBe('low-angle close view')
  expect(savedTemplate.template['x-agent-note']).toEqual(AGENT_TEMPLATE['x-agent-note'])
  expect(savedTemplate.provenance).toEqual(AGENT_TEMPLATE.source)

  const forked = await callTool<{ templateId: string }>(page, 'prompt_canvas_save_template', {
    source: { kind: 'definition', template: AGENT_TEMPLATE },
    mode: 'fork',
    title: 'Forked Agent-authored Light Study',
  })
  const forkedTemplate = await callTool<{
    template: { source: typeof AGENT_TEMPLATE.source }
  }>(page, 'prompt_canvas_get_template', { templateId: forked.templateId })
  expect(forkedTemplate.template.source).toEqual(AGENT_TEMPLATE.source)

  const listed = await callTool<{
    templates: Array<{ id: string; title: string }>
    nextCursor: null
  }>(page, 'prompt_canvas_list_templates', { query: saved.templateId, limit: 10 })
  expect(listed.nextCursor).toBeNull()
  expect(listed.templates.some((template) => template.id === saved.templateId)).toBe(true)
})

test('output slots negotiate operations and workflow stages reach generation context', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )

  const created = await callTool<{ workspaceId: string }>(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'definition', template: SLOT_ROUTING_TEMPLATE },
    placement: 'new-page',
    openAfterCreate: true,
  })
  await page.locator('.pc-more-menu > summary').click()
  await page.getByRole('button', { name: 'Diagnostics' }).click()
  const secondary = page.locator('.pc-panel--output').filter({ hasText: 'Generate-only secondary' })
  await expect(secondary).toBeVisible()
  const secondaryLayer = page
    .locator('.pc-layer-list button')
    .filter({ hasText: 'Generate-only secondary' })
  await expect(secondaryLayer).toHaveAttribute('title', 'Open this block')
  await secondaryLayer.click()
  await expect(secondary).toHaveClass(/is-editing/)

  // The panel action event is the same runtime path used by the visible
  // Prepare button. Dispatching it here keeps this test focused on routing
  // while avoiding tldraw's canvas hit-testing overlay in headless Chromium.
  await page.evaluate((workspaceId) => {
    window.dispatchEvent(
      new CustomEvent('prompt-canvas:panel-action', {
        detail: { workspaceId, type: 'prepare-generation', outputSlotId: 'secondary' },
      }),
    )
  }, created.workspaceId)
  await expect(page.locator('.pc-context-summary')).toContainText('generate')
  await expect(page.locator('.pc-context-summary')).toContainText('secondary')
  await page.getByRole('button', { name: 'Done' }).click()

  const context = await callTool<{
    requestId: string
    generationRevision: number
    targetOutputId: string
    promptDigest: string
    controlContext: { workflow?: { activeStageId: string | null; activeStageInstructions: string | null } }
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: created.workspaceId,
    operation: 'generate',
    outputSlotId: 'secondary',
  })
  expect(context.targetOutputId).toBe('secondary')
  expect(context.controlContext.workflow?.activeStageId).toBe('brief')
  expect(context.controlContext.workflow?.activeStageInstructions).toContain('object')

  await callTool(page, 'prompt_canvas_add_generated_asset', {
    workspaceId: created.workspaceId,
    requestId: context.requestId,
    generationRevision: context.generationRevision,
    assets: [
      {
        source: { kind: 'data_url', dataUrl: TINY_PNG },
        mimeType: 'image/png',
        label: 'Routing image',
        outputSlotId: 'secondary',
        operation: 'generate',
        promptDigest: context.promptDigest,
      },
    ],
  })
  await expect(secondary.locator('img[alt="Routing image"]')).toBeVisible()
  await expect(secondary.getByRole('button', { name: 'Edit with Codex' })).toHaveCount(0)
  await expect(secondary.getByRole('button', { name: 'Upscale' })).toHaveCount(0)

  const workflow = page.locator('.pc-panel--workflow').filter({ hasText: 'Plan the explanation' })
  await expect(workflow).toBeVisible()
  await page.evaluate((workspaceId) => {
    window.dispatchEvent(
      new CustomEvent('prompt-canvas:panel-action', {
        detail: {
          workspaceId,
          type: 'workspace-update',
          operation: { op: 'set_workflow_stage', stageId: 'plan', status: 'active' },
        },
      }),
    )
  }, created.workspaceId)

  await expect
    .poll(async () => {
      const inspected = await callTool<{ workflow: { statuses: Record<string, string> } }>(
        page,
        'prompt_canvas_inspect',
        { workspaceId: created.workspaceId, include: ['workflow'] },
      )
      return inspected.workflow?.statuses?.plan
    })
    .toBe('active')

  const nextContext = await callTool<{
    promptDigest: string
    controlContext: { workflow?: { activeStageId: string | null; activeStageInstructions: string | null } }
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: created.workspaceId,
    operation: 'generate',
    outputSlotId: 'secondary',
  })
  expect(nextContext.controlContext.workflow?.activeStageId).toBe('plan')
  expect(nextContext.controlContext.workflow?.activeStageInstructions).toContain('visual route')
  expect(nextContext.promptDigest).not.toBe(context.promptDigest)
})

test('Diagnostics opens a selected block with one click', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () => Object.keys((window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> }).__promptCanvasTools).length > 0,
  )
  await createTravelWorkspace(page)
  await page.locator('.pc-more-menu > summary').click()
  await page.getByRole('button', { name: 'Diagnostics' }).click()

  const controlsLayer = page.locator('.pc-layer-list button').filter({ hasText: 'Format' })
  await expect(controlsLayer).toBeVisible()
  await expect(controlsLayer).toHaveAttribute('title', 'Open this block')
  await controlsLayer.click()

  const controls = page.locator('.pc-panel--controls.is-editing')
  await expect(controls).toBeVisible()
  const aspectRatio = controls.locator('select').first()
  await expect(aspectRatio).toBeEnabled()
  await aspectRatio.selectOption('16:9')
  await expect(aspectRatio).toHaveValue('16:9')
})

test('factuality source notes reach the registered generation context', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )

  const created = await callTool<{ workspaceId: string; revision: number }>(
    page,
    'prompt_canvas_create_workspace',
    { source: { kind: 'definition', template: FACTUALITY_TEMPLATE } },
  )
  const initial = await callTool<{
    promptDigest: string
    factuality: { mode: string; sourceNotes: string; suppliedClaims: string; creativeInterpretation: null }
    hostInstruction: string
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: created.workspaceId,
    operation: 'generate',
  })
  expect(initial.factuality).toEqual({
    mode: 'supplied',
    sourceNotes: 'The supplied system has three labeled stages connected in sequence.',
    suppliedClaims: 'The supplied system has three labeled stages connected in sequence.',
    creativeInterpretation: null,
  })
  expect(initial.hostInstruction).toContain('not independently verified facts')
  expect(initial.hostInstruction).toContain('not proof of accuracy')

  const updated = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspaceId,
    expectedRevision: created.revision,
    operations: [{
      op: 'set_control',
      controlId: 'factuality-source-notes',
      value: 'The revised supplied system has four labeled stages connected in sequence.',
    }],
  })
  const revised = await callTool<{
    promptDigest: string
    factuality: { sourceNotes: string; suppliedClaims: string }
  }>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: created.workspaceId,
    operation: 'generate',
  })
  expect(updated.revision).toBe(1)
  expect(revised.factuality.sourceNotes).toBe(
    'The revised supplied system has four labeled stages connected in sequence.',
  )
  expect(revised.factuality.suppliedClaims).toBe(revised.factuality.sourceNotes)
  expect(revised.promptDigest).not.toBe(initial.promptDigest)
})
