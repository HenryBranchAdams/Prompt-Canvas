import { expect, test, type Page } from '@playwright/test'
import { starterManifest, starterTemplates } from '../src/generated/starterTemplates'
import { webmcpCatalog } from '../src/generated/webmcpCatalog'

const NEW_TEMPLATE_IDS = [
  'character-continuity-kit',
  'retail-object-family-study',
  'scene-rhythm-board',
  'object-logic-atlas',
  'learning-trail-map',
  'wordform-material-study',
  'symbol-language-sheet',
  'sequential-moment-page',
] as const

const API_ONLY_BINDING_TARGETS = new Set([
  'model',
  'size',
  'quality',
  'background',
  'output_format',
  'output_compression',
  'n',
  'moderation',
  'stream',
  'partial_images',
  'user',
  'input_fidelity',
  'seed',
  'cfg',
  'sampler',
  'scheduler',
])

const ACCURACY_DEPENDENT_TEMPLATE_IDS = [
  'retail-object-family-study',
  'object-logic-atlas',
  'learning-trail-map',
] as const

const EXTENSION_CASES = [
  {
    templateId: 'object-logic-atlas',
    controlId: 'visual-mode',
    contextTarget: 'image.composition.explanation_view',
    originalValue: 'annotated-overview',
    extensionValue: 'inside-out-explainer',
    operation: 'generate',
    values: { 'factuality-mode': 'mixed', 'source-notes': 'Test source note for the same object.' },
  },
] as const

type RegisteredTool = {
  name: string
  execute(input: unknown): Promise<unknown> | unknown
}

type TemplateLike = {
  id: string
  generation: {
    operations: string[]
    defaultOperation?: string
    preferredMimeTypes?: string[]
    modelHint?: string
    'x-model-hint-boundary'?: string
  }
  controls?: Array<{
    id: string
    defaultValue?: unknown
    options?: Array<{ value: unknown }>
    min?: number
    max?: number
    step?: number
    binding: { mode: string; target: string }
  }>
  workflow?: { stages: Array<{ id: string }> }
  source?: {
    kind?: string
    creator?: string
    promptUsage?: string
    url?: string
  }
}

type InspectResult = {
  workspace: {
    workspaceId: string
    templateId: string | null
  }
  revision: number
  controls?: { values: Record<string, unknown> }
  prompt?: { body: string; negativePrompt: string; displayPart?: string }
  workflow?: {
    workflow: { stages: Array<{ id: string }> }
    statuses: Record<string, string>
  } | null
  elements: Array<{ semanticId: string; x: number; y: number; width?: number; height?: number }>
  selection?: { semanticIds: string[]; assetIds: string[] }
}

type GenerationContext = {
  promptDigest: string
  controlContext: Record<string, unknown>
  outputRequirements: {
    aspectRatio: string
  }
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

async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
}

async function waitForPersistedWorkspace(page: Page, workspaceId: string, revision: number) {
  await page.waitForFunction(
    async ({ expectedWorkspaceId, expectedRevision }) => {
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
          const candidate = record as {
            typeName?: unknown
            meta?: {
              promptCanvas?: {
                workspaceId?: unknown
                documentRevision?: unknown
              }
            }
          }
          const manifest = candidate.meta?.promptCanvas
          return candidate.typeName === 'page' &&
            manifest?.workspaceId === expectedWorkspaceId &&
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
        return pagePersisted && persistenceIdle
      } finally {
        database.close()
      }
    },
    { expectedWorkspaceId: workspaceId, expectedRevision: revision },
  )
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

function asTemplate(id: string): TemplateLike {
  const template = (starterTemplates as unknown as Record<string, TemplateLike>)[id]
  if (!template) throw new Error(`Generated starter template ${id} is missing.`)
  return template
}

function alternateValue(
  control: NonNullable<TemplateLike['controls']>[number],
  current: unknown,
): unknown {
  const option = control.options?.find((candidate) => !Object.is(candidate.value, current))
  if (Array.isArray(current) && option) return [...current, option.value]
  if (option) return option.value
  if (typeof current === 'number') {
    const step = control.step ?? 1
    const min = control.min ?? Number.NEGATIVE_INFINITY
    const max = control.max ?? Number.POSITIVE_INFINITY
    return current + step <= max ? current + step : current - step >= min ? current - step : undefined
  }
  if (typeof current === 'boolean') return !current
  if (typeof current === 'string') return `${current} (test revision)`
  return undefined
}

test.beforeEach(async ({ page }) => {
  await installMockWebMcp(page)
})

test('WebMCP registration retries a transiently rejected tool without duplicating successes', async ({ page }) => {
  await page.addInitScript((retryToolName: string) => {
    const attempts: Record<string, number> = {}
    Object.defineProperty(window, '__promptCanvasRegistrationAttempts', {
      configurable: true,
      get: () => ({ ...attempts }),
    })
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool) {
          attempts[tool.name] = (attempts[tool.name] ?? 0) + 1
          if (tool.name === retryToolName) {
            if (attempts[tool.name] === 1) return Promise.reject(new Error('Transient host rejection'))
          }
          ;(window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
            .__promptCanvasTools[tool.name] = tool
          return Promise.resolve()
        },
      },
    })
  }, webmcpCatalog.tools[0].name)

  await openApp(page)
  const attempts = await page.evaluate(
    () => (window as unknown as { __promptCanvasRegistrationAttempts: Record<string, number> })
      .__promptCanvasRegistrationAttempts,
  )
  expect(Object.keys(attempts).sort()).toEqual(webmcpCatalog.tools.map((tool) => tool.name).sort())
  expect(attempts[webmcpCatalog.tools[0].name]).toBe(2)
  for (const tool of webmcpCatalog.tools.slice(1)) expect(attempts[tool.name]).toBe(1)
})

test('starter manifest and library expose each canonical template once', async ({ page }) => {
  await openApp(page)

  const manifest = starterManifest as unknown as {
    templateCount: number
    templates: Array<{
      id: string
      featured: boolean
      source?: { creator?: string; promptUsage?: string; url?: string | null }
    }>
  }
  const manifestIds = manifest.templates.map((entry) => entry.id)
  expect(new Set(manifestIds).size).toBe(manifestIds.length)
  expect(manifest.templates).toHaveLength(manifest.templateCount)
  for (const entry of manifest.templates) {
    expect(entry.source?.promptUsage).toBe('original')
  }
  for (const entry of manifest.templates.filter(({ id }) => NEW_TEMPLATE_IDS.includes(id as typeof NEW_TEMPLATE_IDS[number]))) {
    expect(entry.featured).toBe(false)
    expect(entry.source).toMatchObject({ creator: 'Prompt Canvas', promptUsage: 'original', url: null })
  }
  expect(Object.keys(starterTemplates)).toHaveLength(manifest.templateCount)
  for (const id of manifestIds) expect(Object.prototype.hasOwnProperty.call(starterTemplates, id)).toBe(true)

  for (const id of NEW_TEMPLATE_IDS) {
    const template = asTemplate(id)
    expect(template.source).toMatchObject({
      kind: 'first-party',
      creator: 'Prompt Canvas',
      promptUsage: 'original',
    })
    expect(template.source?.url).toBeUndefined()
    expect(template.generation.modelHint).toBeUndefined()
    expect(template.generation.preferredMimeTypes).toEqual(['image/png'])
    expect(template.generation['x-model-hint-boundary']).toBeUndefined()
    for (const control of template.controls ?? []) {
      expect(API_ONLY_BINDING_TARGETS.has(control.binding.target)).toBe(false)
    }
  }

  for (const templateId of ['object-logic-atlas']) {
    const template = asTemplate(templateId) as TemplateLike & Record<string, unknown>
    expect(template['x-source-provenance']).toBeUndefined()
    expect(template['x-extension-design']).toMatchObject({ source: 'first-party-original', promptUsage: 'original' })
  }

  const listed = await callTool<{
    total: number
    templates: Array<{ id: string }>
  }>(page, 'prompt_canvas_list_templates', { limit: 100 })
  expect(listed.total).toBe(manifest.templateCount)
  expect(listed.templates).toHaveLength(manifest.templateCount)
  expect(new Set(listed.templates.map((entry) => entry.id)).size).toBe(manifest.templateCount)
  expect(listed.templates.map((entry) => entry.id)).toEqual(expect.arrayContaining(manifestIds))

  for (const extensionId of ['inside-out-explainer']) {
    expect(manifestIds).not.toContain(extensionId)
    expect(listed.templates.map((entry) => entry.id)).not.toContain(extensionId)
  }

  for (const templateId of ACCURACY_DEPENDENT_TEMPLATE_IDS) {
    const factualityControl = asTemplate(templateId).controls?.find(
      (control) => control.binding.target === 'factuality.mode',
    )
    expect(factualityControl?.defaultValue).toBe('supplied')
  }

  await expect(page.getByRole('heading', { name: 'What would you like to make?' })).toBeVisible()
  await expect(page.locator('.pc-library__grid .pc-template-card:not(.pc-template-card--blank)')).toHaveCount(10)
  await expect(page.locator('.pc-system-list button')).toHaveCount(9)
  await expect(page.locator('.pc-template-card__preview > img')).toHaveCount(10)
  expect(await page.locator('.pc-template-card__preview > img').evaluateAll((images) =>
    images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
  )).toBe(true)

  await page.getByLabel('Search recipes').fill('put me somewhere else')
  await expect(page.locator('.pc-library__grid .pc-template-card:not(.pc-template-card--blank)')).toHaveCount(1)
  await expect(page.locator('.pc-template-card').filter({ hasText: 'Change the background' })).toBeVisible()
})

test('official retrieval returns summaries, snapshots exact lineage, and keeps saved recipes local', async ({ page }) => {
  const forbiddenWrites: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/official-library/prompts') && request.method() !== 'GET') {
      forbiddenWrites.push(`${request.method()} ${path}`)
    }
  })
  await openApp(page)

  const listed = await callTool<{
    templates: Array<{
      source: 'official'
      id: string
      version: number
      hash: string
      title: string
      template?: unknown
    }>
  }>(page, 'prompt_canvas_list_templates', {
    scope: 'official',
    query: 'replace the room but keep my face and pose',
    intents: ['edit'],
    inputModes: ['single-image'],
    preservationNeeds: ['identity', 'pose'],
    limit: 8,
  })
  const selected = listed.templates.find(({ id }) => id === 'change-background')
  expect(selected).toBeTruthy()
  expect(selected?.source).toBe('official')
  expect(selected?.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(selected?.template).toBeUndefined()

  const fetched = await callTool<{
    source: 'official'
    hash: string
    template: { id: string; version: number }
    validation: { valid: boolean }
  }>(page, 'prompt_canvas_get_template', {
    source: 'official',
    templateId: selected!.id,
    version: selected!.version,
    expectedHash: selected!.hash,
  })
  expect(fetched.source).toBe('official')
  expect(fetched.hash).toBe(selected!.hash)
  expect(fetched.validation.valid).toBe(true)

  const created = await callTool<{ workspaceId: string }>(page, 'prompt_canvas_create_workspace', {
    source: {
      kind: 'template',
      origin: 'official',
      templateId: selected!.id,
      version: selected!.version,
      expectedHash: selected!.hash,
    },
    placement: 'new-page',
    openAfterCreate: true,
  })
  const inspected = await callTool<{
    workspace: {
      templateSource: { origin: string; id: string; version: number; hash: string }
    }
  }>(page, 'prompt_canvas_inspect', { workspaceId: created.workspaceId })
  expect(inspected.workspace.templateSource).toEqual({
    origin: 'official',
    id: selected!.id,
    version: selected!.version,
    hash: selected!.hash,
  })

  await callTool(page, 'prompt_canvas_save_template', {
    source: { kind: 'workspace', workspaceId: created.workspaceId },
    mode: 'fork',
    title: 'My background recipe',
  })
  expect(forbiddenWrites).toEqual([])
})

test('start-fast recipe opens a connected canvas with directly interactive controls', async ({ page }) => {
  await openApp(page)

  const recipe = page.locator('.pc-template-card').filter({ hasText: 'Create an image from words' })
  await recipe.getByRole('button', { name: 'Start' }).click()
  await expect(page.locator('.pc-library')).toHaveCount(0)

  const initial = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    include: ['prompt', 'controls', 'layout'],
  })
  expect(initial.workspace.templateId).toBe('create-from-words')
  expect(initial.elements.map(({ semanticId }) => semanticId)).toEqual(expect.arrayContaining([
    'your-input',
    'visual-direction',
    'composition',
    'format',
    'full-prompt',
    'primary-output',
    'variation-strip',
  ]))

  const nextBrief = 'A glass greenhouse glowing softly in a snowy forest at blue hour'
  const inputPanel = page.locator('.pc-panel--controls').filter({ hasText: '1. Your input' })
  const brief = inputPanel.getByRole('textbox', { name: 'Describe your image' })
  await expect(brief).toBeEnabled()
  await brief.fill(nextBrief)
  await expect.poll(async () => {
    const inspected = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
      workspaceId: initial.workspace.workspaceId,
      include: ['prompt', 'controls'],
    })
    return inspected.controls?.values.brief
  }).toBe(nextBrief)
})

test('travel poster opens as editable modular prompt blocks with stable seeded geometry', async ({ page }) => {
  await openApp(page)

  const created = await callTool<{ workspaceId: string; revision: number; createdElements: string[] }>(
    page,
    'prompt_canvas_create_workspace',
    { source: { kind: 'template', templateId: 'travel-poster', values: {} }, openAfterCreate: true },
  )
  expect(created.createdElements).toEqual([
    'subject-card',
    'format-card',
    'people-card',
    'style-card',
    'composition-card',
    'palette-card',
    'typography-card',
    'local-character-card',
    'mood-card',
    'core-direction-card',
    'poster-output',
    'negative-prompt-card',
    'variation-strip',
  ])

  const inspected = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
    include: ['prompt', 'controls', 'layout'],
  })
  expect(inspected.elements.find(({ semanticId }) => semanticId === 'subject-card')).toMatchObject({
    x: 40,
    y: 40,
    width: 180,
    height: 130,
  })
  expect(inspected.elements.find(({ semanticId }) => semanticId === 'poster-output')).toMatchObject({
    x: 690,
    y: 90,
    width: 280,
    height: 373,
  })
  expect(inspected.elements.find(({ semanticId }) => semanticId === 'core-direction-card')).toMatchObject({
    x: 240,
    y: 530,
    width: 420,
    height: 150,
  })
  expect(inspected.controls?.values).toMatchObject({
    'typography-direction': expect.any(String),
    'local-character': expect.any(String),
    mood: 'Fresh, airy, peaceful, refined, contemporary, elegant.',
  })

  const editedBody = 'Create a premium Chicago travel poster with a calm, unmistakably local point of view.'
  await page.locator('.pc-more-menu > summary').click()
  await page.getByRole('button', { name: 'Diagnostics' }).click()
  const bodyLayer = page.locator('.pc-layer-list button').filter({ hasText: 'Core direction' })
  await bodyLayer.click()
  const bodyEditor = page.locator('.pc-panel--prompt.is-editing').filter({ hasText: 'Core direction' })
  await bodyEditor.locator('textarea').fill(editedBody)
  await bodyEditor.locator('textarea').press('Tab')
  await expect.poll(async () => {
    const current = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
      workspaceId: created.workspaceId,
      include: ['prompt'],
    })
    return current.prompt?.body
  }).toBe(editedBody)
  const bodyEdited = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
    include: ['prompt', 'controls', 'layout'],
  })

  const context = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
    workspaceId: created.workspaceId,
    operation: 'generate',
    outputSlotId: 'primary',
  })
  expect(context.controlContext).toMatchObject({
    'typography-direction': expect.any(String),
    'local-character': expect.any(String),
    mood: 'Fresh, airy, peaceful, refined, contemporary, elegant.',
  })

  const movedPosition = { x: 131, y: 117 }
  const moved = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspaceId,
    expectedRevision: bodyEdited.revision,
    operations: [{ op: 'move_element', elementId: 'subject-card', ...movedPosition }],
  })
  const revised = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspaceId,
    expectedRevision: moved.revision,
    operations: [
      { op: 'set_control', controlId: 'mood', value: 'Quiet, lucid, lake-breezy.' },
      { op: 'set_negative_prompt', body: 'Avoid clutter, crowds, and generic landmark collages.' },
    ],
  })
  const after = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
    include: ['prompt', 'controls', 'layout'],
  })
  expect(after.revision).toBe(revised.revision)
  expect(after.prompt?.negativePrompt).toBe('Avoid clutter, crowds, and generic landmark collages.')
  expect(after.prompt?.body).toBe(editedBody)
  expect(after.controls?.values.mood).toBe('Quiet, lucid, lake-breezy.')
  expect(after.elements.find(({ semanticId }) => semanticId === 'subject-card')).toMatchObject(movedPosition)

  await waitForPersistedWorkspace(page, created.workspaceId, after.revision)
  await openApp(page)
  const reloaded = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
    include: ['prompt', 'controls', 'layout'],
  })
  expect(reloaded.prompt?.body).toBe(editedBody)
  expect(reloaded.prompt?.negativePrompt).toBe('Avoid clutter, crowds, and generic landmark collages.')
  expect(reloaded.elements.find(({ semanticId }) => semanticId === 'subject-card')).toMatchObject(movedPosition)
})

test('expanded templates wire presets, workflow stages, and generation context', async ({ page }) => {
  await openApp(page)

  for (const templateId of NEW_TEMPLATE_IDS) {
    const template = asTemplate(templateId)
    const values: Record<string, unknown> = {}
    const factualityMode = template.controls?.find(
      (control) => control.binding.target === 'factuality.mode',
    )
    const factualityNotes = template.controls?.find(
      (control) => control.binding.target === 'factuality.sourceNotes',
    )
    if (factualityMode) values[factualityMode.id] = 'mixed'
    if (factualityNotes) values[factualityNotes.id] = 'Test source note for context resolution.'

    const created = await callTool<{ workspaceId: string; templateId: string }>(
      page,
      'prompt_canvas_create_workspace',
      { source: { kind: 'template', templateId, values }, openAfterCreate: false },
    )
    expect(created.templateId).toBe(templateId)

    const initial = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
      workspaceId: created.workspaceId,
      include: ['controls', 'workflow'],
    })
    expect(initial.workspace.templateId).toBe(templateId)
    if (template.workflow) {
      expect(initial.workflow?.workflow.stages.map((stage) => stage.id)).toEqual(
        template.workflow.stages.map((stage) => stage.id),
      )
    }

    const operation = template.generation.defaultOperation ?? template.generation.operations[0]
    if (!operation) throw new Error(`${templateId} declares no generation operation.`)
    let currentRevision = initial.revision
    for (const control of template.controls ?? []) {
      if (!['agent-context', 'generation'].includes(control.binding.mode)) continue
      const before = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
        workspaceId: created.workspaceId,
        operation,
      })
      const current = control.binding.mode === 'generation'
        ? before.outputRequirements.aspectRatio
        : before.controlContext[control.binding.target]
      const next = alternateValue(control, current)
      if (next === undefined || Object.is(next, current)) continue
      const updated = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
        workspaceId: created.workspaceId,
        expectedRevision: currentRevision,
        operations: [{ op: 'set_control', controlId: control.id, value: next }],
        reason: `Verify ${control.id} context binding`,
      })
      currentRevision = updated.revision
      const after = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
        workspaceId: created.workspaceId,
        operation,
      })
      if (control.binding.mode === 'generation') {
        expect(after.outputRequirements.aspectRatio).toEqual(next)
      } else {
        expect(after.controlContext[control.binding.target]).toEqual(next)
      }
      expect(after.promptDigest).not.toBe(before.promptDigest)
    }
  }
})

test('library creation and control edits preserve manual layout across fork and reload', async ({ page }) => {
  await openApp(page)

  await page.getByLabel('Search recipes').fill('Scene Rhythm Board')
  const card = page.locator('.pc-system-list button').filter({ hasText: 'Scene Rhythm Board' })
  await expect(card).toHaveCount(1)
  await card.click()
  await expect(page.locator('.pc-library')).toHaveCount(0)

  const created = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    include: ['controls', 'workflow'],
  })
  expect(created.workspace.templateId).toBe('scene-rhythm-board')
  expect(created.workflow?.workflow.stages.map((stage) => stage.id)).toContain('beat-plan')

  const sequenceTemplate = asTemplate('scene-rhythm-board')
  const beatCountControl = sequenceTemplate.controls?.find(({ id }) => id === 'beat-count')
  if (!beatCountControl) throw new Error('Scene rhythm beat-count control is missing.')
  const originalBeatCount = created.controls?.values['beat-count']
  const changedBeatCount = alternateValue(beatCountControl, originalBeatCount)
  if (typeof changedBeatCount !== 'number') throw new Error('Scene rhythm beat count has no numeric alternate.')
  await callTool(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspace.workspaceId,
    expectedRevision: created.revision,
    operations: [{ op: 'set_control', controlId: 'beat-count', value: changedBeatCount }],
    reason: 'Verify scene-rhythm beat-count control',
  })

  const afterPanelCount = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspace.workspaceId,
    include: ['controls', 'workflow'],
  })
  const promptElement = afterPanelCount.elements.find(
    (element) => element.semanticId === 'scene-rhythm-prompt-block',
  )
  if (!promptElement) throw new Error('Scene rhythm prompt block is missing from the created workspace.')
  const movedPosition = { x: promptElement.x + 137, y: promptElement.y + 89 }
  const moved = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspace.workspaceId,
    expectedRevision: afterPanelCount.revision,
    operations: [{ op: 'move_element', elementId: promptElement.semanticId, ...movedPosition }],
    reason: 'Verify manual layout preservation',
  })

  const cameraControl = sequenceTemplate.controls?.find(({ id }) => id === 'camera-language')
  if (!cameraControl) throw new Error('Scene rhythm camera-language control is missing.')
  const originalCameraLanguage = afterPanelCount.controls?.values['camera-language']
  const changedCameraLanguage = alternateValue(cameraControl, originalCameraLanguage)
  if (!changedCameraLanguage) throw new Error('Scene rhythm camera language has no alternate preset.')
  await callTool(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspace.workspaceId,
    expectedRevision: moved.revision,
    operations: [{ op: 'set_control', controlId: 'camera-language', value: changedCameraLanguage }],
    reason: 'Verify unrelated control preserves manual geometry',
  })
  const afterUnrelatedControl = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspace.workspaceId,
    include: ['controls', 'workflow'],
  })
  const preservedBeforeFork = afterUnrelatedControl.elements.find(
    (element) => element.semanticId === promptElement.semanticId,
  )
  expect(preservedBeforeFork).toMatchObject(movedPosition)

  await callTool(page, 'prompt_canvas_update_workspace', {
    workspaceId: created.workspace.workspaceId,
    expectedRevision: afterUnrelatedControl.revision,
    operations: [{ op: 'set_workflow_stage', stageId: 'beat-plan', status: 'complete' }],
    reason: 'Verify workflow stage persistence',
  })
  const beforeSave = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspace.workspaceId,
    include: ['controls', 'workflow'],
  })
  expect(beforeSave.workflow?.statuses['beat-plan']).toBe('complete')
  await page.locator('.pc-more-menu > summary').click()
  await page.getByRole('button', { name: 'Save as recipe' }).click()
  await expect.poll(async () => {
    const savedTemplates = await callTool<{ templates: Array<{ title: string }> }>(
      page,
      'prompt_canvas_list_templates',
      { query: 'Scene Rhythm Board copy', limit: 10 },
    )
    return savedTemplates.templates.some(
      (template) => template.title === 'Scene Rhythm Board copy',
    )
  }).toBe(true)
  await waitForPersistedWorkspace(page, created.workspace.workspaceId, beforeSave.revision)

  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    () =>
      Object.keys(
        (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
          .__promptCanvasTools,
      ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
  )
  const afterReload = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspace.workspaceId,
    include: ['controls', 'workflow'],
  })
  expect(afterReload.controls?.values['beat-count']).toBe(changedBeatCount)
  expect(afterReload.controls?.values['camera-language']).toBe(changedCameraLanguage)
  expect(afterReload.workflow?.statuses['beat-plan']).toBe('complete')
  expect(afterReload.elements.find((element) => element.semanticId === promptElement.semanticId)).toMatchObject(
    movedPosition,
  )

  const savedTemplates = await callTool<{ templates: Array<{ title: string }> }>(
    page,
    'prompt_canvas_list_templates',
    { query: 'Scene Rhythm Board copy', limit: 10 },
  )
  expect(savedTemplates.templates.some((template) => template.title === 'Scene Rhythm Board copy')).toBe(true)
})

test('embedded extension modes alter context and retain the original mode', async ({ page }) => {
  await openApp(page)

  for (const extension of EXTENSION_CASES) {
    const created = await callTool<{ workspaceId: string }>(page, 'prompt_canvas_create_workspace', {
      source: { kind: 'template', templateId: extension.templateId, values: extension.values },
      openAfterCreate: false,
    })
    let revision = (await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
      workspaceId: created.workspaceId,
      include: ['controls'],
    })).revision

    const baseline = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
      workspaceId: created.workspaceId,
      operation: extension.operation,
    })
    const selected = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
      workspaceId: created.workspaceId,
      expectedRevision: revision,
      operations: [{
        op: 'set_control',
        controlId: extension.controlId,
        value: extension.extensionValue,
      }],
      reason: `Select ${extension.extensionValue}`,
    })
    revision = selected.revision
    const extended = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
      workspaceId: created.workspaceId,
      operation: extension.operation,
    })
    expect(extended.controlContext[extension.contextTarget]).toBe(extension.extensionValue)
    expect(extended.promptDigest).not.toBe(baseline.promptDigest)

    const forkTitle = `${extension.templateId} extension fork`
    const saved = await callTool<{ templateId: string; libraryEntry: { title: string } }>(
      page,
      'prompt_canvas_save_template',
      {
        source: { kind: 'workspace', workspaceId: created.workspaceId },
        title: forkTitle,
        mode: 'fork',
      },
    )
    expect(saved.libraryEntry.title).toBe(forkTitle)
    const savedTemplateResult = await callTool<{ template: TemplateLike }>(page, 'prompt_canvas_get_template', {
      templateId: saved.templateId,
    })
    expect(savedTemplateResult.template.controls?.find(({ id }) => id === extension.controlId)?.defaultValue).toBe(
      extension.extensionValue,
    )

    await waitForPersistedWorkspace(page, created.workspaceId, revision)
    await page.reload()
    await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
    await page.waitForFunction(
      () =>
        Object.keys(
          (window as unknown as { __promptCanvasTools: Record<string, RegisteredTool> })
            .__promptCanvasTools,
        ).length === (window as unknown as { __promptCanvasExpectedToolNames: string[] }).__promptCanvasExpectedToolNames.length,
    )
    const afterReload = await callTool<InspectResult>(page, 'prompt_canvas_inspect', {
      workspaceId: created.workspaceId,
      include: ['controls'],
    })
    expect(afterReload.controls?.values[extension.controlId]).toBe(extension.extensionValue)
    const reloadedContext = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
      workspaceId: created.workspaceId,
      operation: extension.operation,
    })
    expect(reloadedContext.promptDigest).toBe(extended.promptDigest)

    const restored = await callTool<{ revision: number }>(page, 'prompt_canvas_update_workspace', {
      workspaceId: created.workspaceId,
      expectedRevision: afterReload.revision,
      operations: [{
        op: 'set_control',
        controlId: extension.controlId,
        value: extension.originalValue,
      }],
      reason: `Restore ${extension.originalValue}`,
    })
    const original = await callTool<GenerationContext>(page, 'prompt_canvas_get_generation_context', {
      workspaceId: created.workspaceId,
      operation: extension.operation,
    })
    expect(original.controlContext[extension.contextTarget]).toBe(extension.originalValue)
    expect(original.promptDigest).toBe(baseline.promptDigest)
    expect(restored.revision).toBeGreaterThan(revision)
  }
})
