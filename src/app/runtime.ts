import {
  AssetRecordType,
  createShapeId,
  type Editor,
  type TLAssetId,
  type TLImageAsset,
  type TLPage,
  type TLPageId,
  type TLShapeId,
} from 'tldraw'
import { ActivityStore } from '../activity/activity-store'
import { resolveAssetSource, AssetTransportRegistry } from '../generation/asset-transport'
import { DEFAULT_MAX_IMAGES_PER_IMPORT } from '../generation/asset-validation-core'
import { webmcpCatalog } from '../generated/webmcpCatalog'
import { TemplateLibrary, createBlankTemplate, type SaveTemplateMode } from '../library/template-library'
import { PromptCanvasDatabase } from '../persistence/database'
import {
  PROMPT_CANVAS_PANEL_TYPE,
  type PromptCanvasPanelShape,
} from '../shapes/panel-shape'
import {
  PANEL_ACTION_EVENT,
  type PanelActionDetail,
} from '../shapes/panel-events'
import { compileWorkspaceConnections, compileWorkspacePanels } from '../workspaces/layout-compiler'
import { createGenerationRequestId } from '../workspaces/ids'
import { parsePanelPayload, serializePanelPayload } from '../workspaces/panel-data'
import {
  resolveGenerationContext,
  resolveGenerationOperation,
} from '../workspaces/prompt-resolver'
import { archiveOutputAsset, resolveOutputSelection } from '../workspaces/output-state'
import {
  assertDocumentRevision,
  assertGenerationRevision,
  nextRevision,
} from '../workspaces/revisions'
import { createWorkspaceManifest } from '../workspaces/workspace-factory'
import { assertValidTemplate, validateTemplate } from '../workspaces/validation'
import type {
  ActivityEntry,
  AssetSourceInput,
  AssetTransportKind,
  GeneratedAssetProvenance,
  GenerationContext,
  GenerationOperation,
  ImportedImage,
  JsonObject,
  JsonValue,
  OutputManagementOperation,
  OutputPanelPayload,
  PanelDescriptor,
  PanelPayload,
  PromptPanelPayload,
  PromptWorkspaceTemplate,
  ReferenceAsset,
  TemplateValidationResult,
  WorkspaceManifest,
  WorkspaceUpdateOperation,
} from '../workspaces/types'

const PAGE_META_KEY = 'promptCanvas'
const APP_VERSION = '0.1.0'

type ConnectionState = {
  checked: boolean
  available: boolean
  registered: number
  failed: number
  errors: string[]
}

export type RuntimeSnapshot = {
  initialized: boolean
  activeWorkspace?: WorkspaceManifest
  workspaces: Array<{ pageId: string; workspaceId: string; title: string; revision: number }>
  activity: ActivityEntry[]
  verifiedAssetTransports: AssetTransportKind[]
  connection: ConnectionState
  preparedContext?: GenerationContext
  libraryCount: number
  lastError?: string
}

type RuntimeListener = () => void

type PreparedAsset = {
  image: ImportedImage
  label?: string
  outputSlotId: string
  operation: GenerationOperation
  parentAssetIds: string[]
  promptDigest: string
}

type WorkspaceConnectionEndpoint = {
  id: TLShapeId
  semanticId: string
  x: number
  y: number
  w: number
  h: number
}

type GeneratedAssetInput = {
  source: AssetSourceInput
  mimeType: string
  label?: string
  outputSlotId: string
  operation: GenerationOperation
  parentAssetIds?: string[]
  promptDigest: string
}

type WorkspaceCreateSource =
  | { kind: 'template'; templateId: string; values?: Record<string, JsonValue> }
  | { kind: 'definition'; template: unknown }
  | { kind: 'blank'; title: string; prompt?: string }

function clone<T>(value: T): T {
  return structuredClone(value)
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' ? (value as JsonObject) : {}
}

function manifestFromPage(page: TLPage | undefined): WorkspaceManifest | undefined {
  if (!page) return undefined
  const value = (page.meta as Record<string, unknown>)[PAGE_META_KEY]
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<WorkspaceManifest>
  return candidate.schema === 'prompt-canvas.workspace@1' ? (value as WorkspaceManifest) : undefined
}

function pageMetaWithManifest(page: TLPage, manifest: WorkspaceManifest): JsonObject {
  return {
    ...asJsonObject(page.meta),
    [PAGE_META_KEY]: manifest as unknown as JsonValue,
  }
}

function canonicalPromptPayload(manifest: WorkspaceManifest): PromptPanelPayload {
  return {
    kind: 'prompt',
    promptTitle: manifest.templateSnapshot.prompt.title ?? manifest.title,
    body: manifest.templateSnapshot.prompt.body,
    negativePrompt: manifest.templateSnapshot.prompt.negativePrompt ?? '',
  }
}

function isPanelShape(shape: unknown): shape is PromptCanvasPanelShape {
  return Boolean(
    shape &&
      typeof shape === 'object' &&
      'type' in shape &&
      (shape as { type: unknown }).type === PROMPT_CANVAS_PANEL_TYPE,
  )
}

function sanitizeLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim().slice(0, 180)
  return trimmed || fallback
}

function generationRelevant(operation: WorkspaceUpdateOperation): boolean {
  return !(
    operation.op === 'move_element' ||
    operation.op === 'resize_element' ||
    operation.op === 'add_annotation'
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function mimeTypeAccepted(mimeType: string, acceptedMimeTypes: string[] | undefined): boolean {
  if (!acceptedMimeTypes?.length) return true
  return acceptedMimeTypes.some((candidate) => {
    if (candidate === mimeType) return true
    if (!candidate.endsWith('/*')) return false
    return mimeType.startsWith(candidate.slice(0, -1))
  })
}

export class PromptCanvasRuntime {
  readonly database = new PromptCanvasDatabase()
  readonly library = new TemplateLibrary(this.database)
  readonly activity = new ActivityStore(this.database)
  readonly transports = new AssetTransportRegistry()

  private editor?: Editor
  private listeners = new Set<RuntimeListener>()
  private pendingContexts = new Map<string, GenerationContext>()
  private consumedRequestIds = new Set<string>()
  private cleanupFunctions: Array<() => void> = []
  private snapshot: RuntimeSnapshot = {
    initialized: false,
    workspaces: [],
    activity: [],
    verifiedAssetTransports: [],
    connection: { checked: false, available: false, registered: 0, failed: 0, errors: [] },
    libraryCount: 0,
  }
  private manualRevisionScheduled = false
  private runtimeMutationDepth = 0
  private panelActionChain: Promise<void> = Promise.resolve()

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): RuntimeSnapshot {
    return this.snapshot
  }

  getEditor(): Editor {
    if (!this.editor) throw new Error('Prompt Canvas editor is not mounted.')
    return this.editor
  }

  private async uploadLocalImage(input: {
    editor: Editor
    assetId: TLAssetId
    image: ImportedImage
    name: string
    meta: JsonObject
  }): Promise<TLImageAsset> {
    const pending = AssetRecordType.create({
      id: input.assetId,
      type: 'image',
      props: {
        name: input.name,
        src: null,
        w: input.image.width,
        h: input.image.height,
        mimeType: input.image.mimeType,
        isAnimated: false,
        fileSize: input.image.byteLength,
      },
      meta: input.meta,
    }) as TLImageAsset
    const uploaded = await input.editor.uploadAsset(
      pending,
      new File([input.image.bytes.slice().buffer], input.name, { type: input.image.mimeType }),
    )
    return {
      ...pending,
      props: { ...pending.props, src: uploaded.src },
      meta: { ...pending.meta, ...(uploaded.meta ?? {}), ...input.meta },
    }
  }

  private async removeLocalImages(editor: Editor, assetIds: TLAssetId[]): Promise<void> {
    if (assetIds.length === 0) return
    editor.run(() => editor.store.remove(assetIds), { history: 'ignore' })
    await editor.store.props.assets.remove?.(assetIds)
  }

  private assertEditorCurrent(editor: Editor): void {
    if (this.editor !== editor) {
      throw new Error('The Prompt Canvas editor changed while image data was being prepared. Retry the operation.')
    }
  }

  private async compactUnreachableLocalImages(editor: Editor): Promise<void> {
    this.assertEditorCurrent(editor)
    const reachable = new Set<TLAssetId>()
    const workspaces = this.listWorkspacePages()
    for (const { manifest } of workspaces) {
      for (const assetId of this.workspaceAssetIds(manifest.workspaceId)) {
        reachable.add(assetId as TLAssetId)
      }
    }

    const pending = [...reachable]
    for (let index = 0; index < pending.length; index += 1) {
      const asset = editor.getAsset(pending[index])
      const metadata = asset?.meta?.promptCanvas
      if (!metadata || typeof metadata !== 'object') continue
      const provenance = metadata as { schema?: unknown; parentAssetIds?: unknown }
      if (
        provenance.schema !== 'prompt-canvas.asset-provenance@1' ||
        !Array.isArray(provenance.parentAssetIds)
      ) continue
      for (const parentAssetId of provenance.parentAssetIds) {
        if (typeof parentAssetId !== 'string') continue
        const parentId = parentAssetId as TLAssetId
        if (reachable.has(parentId)) continue
        reachable.add(parentId)
        pending.push(parentId)
      }
    }

    const unreachable = editor.getAssets().filter((asset) => {
      const metadata = asset.meta?.promptCanvas
      if (!metadata || typeof metadata !== 'object') return false
      const promptCanvas = metadata as { schema?: unknown; kind?: unknown }
      const owned =
        promptCanvas.schema === 'prompt-canvas.asset-provenance@1' ||
        promptCanvas.kind === 'reference'
      return owned && !reachable.has(asset.id)
    })
    const pendingCleanupIds = uniqueStrings([
      ...workspaces.flatMap(({ manifest }) => manifest.pendingAssetCleanupIds ?? []),
      ...workspaces.flatMap(({ manifest }) => this.outputPanels(manifest.workspaceId).flatMap((panel) => {
        const payload = parsePanelPayload(panel.props.payload)
        return payload.kind === 'output' || payload.kind === 'variations'
          ? payload.pendingAssetCleanupIds ?? []
          : []
      })),
    ]).map((assetId) => assetId as TLAssetId)
    const cleanupIds = uniqueStrings([
      ...unreachable.map((asset) => asset.id),
      ...pendingCleanupIds.filter((assetId) => !reachable.has(assetId)),
    ]) as TLAssetId[]
    await this.removeLocalImages(editor, cleanupIds)

    if (cleanupIds.length > 0) {
      const cleaned = new Set<string>(cleanupIds)
      editor.run(() => {
        for (const { page, manifest } of workspaces) {
          const remaining = (manifest.pendingAssetCleanupIds ?? []).filter(
            (assetId) => !cleaned.has(assetId),
          )
          if (remaining.length === (manifest.pendingAssetCleanupIds ?? []).length) continue
          const next = clone(manifest)
          if (remaining.length > 0) next.pendingAssetCleanupIds = remaining
          else delete next.pendingAssetCleanupIds
          editor.updatePage({ id: page.id, meta: pageMetaWithManifest(page, next) })
        }
        for (const { manifest } of workspaces) {
          for (const panel of this.outputPanels(manifest.workspaceId)) {
            const payload = parsePanelPayload(panel.props.payload)
            if (payload.kind !== 'output' && payload.kind !== 'variations') continue
            const remaining = (payload.pendingAssetCleanupIds ?? []).filter(
              (assetId) => !cleaned.has(assetId),
            )
            if (remaining.length === (payload.pendingAssetCleanupIds ?? []).length) continue
            const next = { ...payload }
            if (remaining.length > 0) next.pendingAssetCleanupIds = remaining
            else delete next.pendingAssetCleanupIds
            this.updatePanelPayload(panel, next)
          }
        }
      }, { history: 'ignore' })
    }
  }

  async attachEditor(editor: Editor): Promise<void> {
    if (this.editor === editor) return
    this.disposeEditorBindings()
    this.editor = editor
    await Promise.all([this.library.initialize(), this.activity.initialize(), this.transports.initialize()])

    this.cleanupFunctions.push(
      this.activity.subscribe(() => this.refreshSnapshot()),
      this.bindPanelActions(),
      this.bindStoreChanges(editor),
    )

    if (this.listWorkspacePages().length === 0) {
      await this.createWorkspace({ kind: 'template', templateId: 'travel-poster' }, 'current-view', true)
    } else {
      const active = manifestFromPage(editor.getCurrentPage())
      if (!active) {
        const first = this.listWorkspacePages()[0]
        if (first) editor.setCurrentPage(first.page.id)
      }
    }
    this.ensureExistingWorkspaceConnections()
    await this.compactUnreachableLocalImages(editor)
    this.snapshot = { ...this.snapshot, initialized: true }
    this.refreshSnapshot()
  }

  dispose(): void {
    this.disposeEditorBindings()
    this.editor = undefined
  }

  private disposeEditorBindings(): void {
    for (const cleanup of this.cleanupFunctions.splice(0)) cleanup()
  }

  setConnectionState(connection: ConnectionState): void {
    this.snapshot = { ...this.snapshot, connection: clone(connection) }
    this.emit()
  }

  clearPreparedContext(): void {
    if (!this.snapshot.preparedContext) return
    const next = { ...this.snapshot }
    delete next.preparedContext
    this.snapshot = next
    this.emit()
  }

  setLastError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.snapshot = { ...this.snapshot, lastError: message }
    this.emit()
  }

  private refreshSnapshot(): void {
    const editor = this.editor
    const workspacePages = editor ? this.listWorkspacePages() : []
    const activeWorkspace = editor ? manifestFromPage(editor.getCurrentPage()) : undefined
    const activity = this.activity.getEntries(activeWorkspace?.workspaceId)
    const next: RuntimeSnapshot = {
      ...this.snapshot,
      workspaces: workspacePages.map(({ page, manifest }) => ({
        pageId: page.id,
        workspaceId: manifest.workspaceId,
        title: manifest.title,
        revision: manifest.documentRevision,
      })),
      activity,
      verifiedAssetTransports: this.transports.getVerified(),
      libraryCount: this.library.listRecords().length,
      ...(activeWorkspace ? { activeWorkspace: clone(activeWorkspace) } : {}),
    }
    if (!activeWorkspace) delete next.activeWorkspace
    this.snapshot = next
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private listWorkspacePages(): Array<{ page: TLPage; manifest: WorkspaceManifest }> {
    const editor = this.editor
    if (!editor) return []
    const result: Array<{ page: TLPage; manifest: WorkspaceManifest }> = []
    for (const page of editor.getPages()) {
      const manifest = manifestFromPage(page)
      if (manifest) result.push({ page, manifest })
    }
    return result
  }

  private findWorkspacePage(workspaceId: string): { page: TLPage; manifest: WorkspaceManifest } {
    const found = this.listWorkspacePages().find((item) => item.manifest.workspaceId === workspaceId)
    if (!found) throw new Error(`Workspace “${workspaceId}” was not found.`)
    return found
  }

  setActiveWorkspace(workspaceId: string): void {
    const editor = this.getEditor()
    const { page } = this.findWorkspacePage(workspaceId)
    editor.setCurrentPage(page.id)
    this.refreshSnapshot()
  }

  private panelShapes(pageId: TLPageId): PromptCanvasPanelShape[] {
    const editor = this.getEditor()
    const shapes: PromptCanvasPanelShape[] = []
    for (const id of editor.getPageShapeIds(pageId)) {
      const shape = editor.getShape(id)
      if (isPanelShape(shape)) shapes.push(shape)
    }
    return shapes
  }

  private findPanel(
    workspaceId: string,
    semanticId: string,
  ): { page: TLPage; manifest: WorkspaceManifest; shape: PromptCanvasPanelShape } {
    const { page, manifest } = this.findWorkspacePage(workspaceId)
    const shape = this.panelShapes(page.id).find((candidate) => candidate.props.semanticId === semanticId)
    if (!shape) throw new Error(`Workspace element “${semanticId}” was not found.`)
    return { page, manifest, shape }
  }

  private panelsByPayloadKind(
    workspaceId: string,
    kind: PanelPayload['kind'],
  ): PromptCanvasPanelShape[] {
    const { page } = this.findWorkspacePage(workspaceId)
    return this.panelShapes(page.id).filter((shape) => {
      try {
        return parsePanelPayload(shape.props.payload).kind === kind
      } catch {
        return false
      }
    })
  }

  private updatePanelPayload(shape: PromptCanvasPanelShape, payload: PanelPayload): void {
    this.getEditor().updateShape({
      id: shape.id,
      type: PROMPT_CANVAS_PANEL_TYPE,
      props: { payload: serializePanelPayload(payload) },
    })
  }

  private panelShapeInput(workspaceId: string, pageId: TLPageId, descriptor: PanelDescriptor) {
    return {
      id: createShapeId(),
      type: PROMPT_CANVAS_PANEL_TYPE,
      parentId: pageId,
      x: descriptor.x,
      y: descriptor.y,
      isLocked: descriptor.locked ?? false,
      props: {
        w: descriptor.w,
        h: descriptor.h,
        workspaceId,
        semanticId: descriptor.semanticId,
        kind: descriptor.kind,
        title: descriptor.title,
        payload: serializePanelPayload(descriptor.payload),
      },
      meta: {
        promptCanvas: {
          workspaceId,
          semanticId: descriptor.semanticId,
          kind: descriptor.kind,
        },
      },
    } as const
  }

  private createWorkspaceConnections(
    manifest: WorkspaceManifest,
    pageId: TLPageId,
    endpoints: WorkspaceConnectionEndpoint[],
    compatibleTemplate?: PromptWorkspaceTemplate,
  ): void {
    const editor = this.getEditor()
    const endpointById = new Map(endpoints.map((endpoint) => [endpoint.semanticId, endpoint]))
    const existingKeys = new Set<string>()
    for (const shapeId of editor.getPageShapeIds(pageId)) {
      const connection = editor.getShape(shapeId)?.meta?.promptCanvasConnection
      if (!connection || typeof connection !== 'object') continue
      const candidate = connection as {
        workspaceId?: unknown
        sourceSemanticId?: unknown
        targetSemanticId?: unknown
      }
      if (
        candidate.workspaceId === manifest.workspaceId &&
        typeof candidate.sourceSemanticId === 'string' &&
        typeof candidate.targetSemanticId === 'string'
      ) {
        existingKeys.add(`${candidate.sourceSemanticId}->${candidate.targetSemanticId}`)
      }
    }
    const arrows = compileWorkspaceConnections(manifest, compatibleTemplate).flatMap((connection) => {
      const key = `${connection.sourceSemanticId}->${connection.targetSemanticId}`
      if (existingKeys.has(key)) return []
      const source = endpointById.get(connection.sourceSemanticId)
      const target = endpointById.get(connection.targetSemanticId)
      if (!source || !target) return []

      const sourceCenter = { x: source.x + source.w / 2, y: source.y + source.h / 2 }
      const targetCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
      const delta = { x: targetCenter.x - sourceCenter.x, y: targetCenter.y - sourceCenter.y }
      const horizontal = Math.abs(delta.x) >= Math.abs(delta.y)
      const sourceAnchor = horizontal
        ? { x: delta.x >= 0 ? 1 : 0, y: 0.5 }
        : {
            x: Math.max(0.12, Math.min(0.88, (targetCenter.x - source.x) / source.w)),
            y: delta.y >= 0 ? 1 : 0,
          }
      const targetAnchor = horizontal
        ? {
            x: delta.x >= 0 ? 0 : 1,
            y: Math.max(0.12, Math.min(0.88, (sourceCenter.y - target.y) / target.h)),
          }
        : {
            x: Math.max(0.12, Math.min(0.88, (sourceCenter.x - target.x) / target.w)),
            y: delta.y >= 0 ? 0 : 1,
          }
      const start = {
        x: source.x + source.w * sourceAnchor.x,
        y: source.y + source.h * sourceAnchor.y,
      }
      const end = {
        x: target.x + target.w * targetAnchor.x,
        y: target.y + target.h * targetAnchor.y,
      }
      const id = createShapeId()
      return [{
        id,
        sourceId: source.id,
        targetId: target.id,
        sourceAnchor,
        targetAnchor,
        input: {
          id,
          type: 'arrow' as const,
          parentId: pageId,
          x: start.x,
          y: start.y,
          opacity: 0.46,
          isLocked: false,
          props: {
            kind: 'elbow' as const,
            start: { x: 0, y: 0 },
            end: { x: end.x - start.x, y: end.y - start.y },
            bend: 0,
            elbowMidPoint: 0.55,
            color: 'grey' as const,
            dash: 'solid' as const,
            size: 's' as const,
            arrowheadStart: 'none' as const,
            arrowheadEnd: 'arrow' as const,
          },
          meta: {
            promptCanvasConnection: {
              workspaceId: manifest.workspaceId,
              sourceSemanticId: connection.sourceSemanticId,
              targetSemanticId: connection.targetSemanticId,
            },
          },
        },
      }]
    })

    if (arrows.length === 0) return
    editor.createShapes(arrows.map((arrow) => arrow.input))
    editor.createBindings(arrows.flatMap((arrow) => [
      {
        type: 'arrow' as const,
        fromId: arrow.id,
        toId: arrow.sourceId,
        props: {
          terminal: 'start' as const,
          normalizedAnchor: arrow.sourceAnchor,
          isExact: false,
          isPrecise: true,
          snap: 'edge' as const,
        },
      },
      {
        type: 'arrow' as const,
        fromId: arrow.id,
        toId: arrow.targetId,
        props: {
          terminal: 'end' as const,
          normalizedAnchor: arrow.targetAnchor,
          isExact: false,
          isPrecise: true,
          snap: 'edge' as const,
        },
      },
    ]))
    editor.sendToBack(arrows.map((arrow) => arrow.id))
    editor.updateShapes(
      arrows.map((arrow) => ({ id: arrow.id, type: 'arrow' as const, isLocked: true })),
    )
    editor.bringToFront(endpoints.map((endpoint) => endpoint.id))
    editor.selectNone()
  }

  private ensureExistingWorkspaceConnections(): void {
    const editor = this.getEditor()
    editor.run(() => {
      for (const { page, manifest } of this.listWorkspacePages()) {
        const currentTemplate = this.library.get(manifest.templateSnapshot.id)
        const endpoints = this.panelShapes(page.id).map((panel) => ({
          id: panel.id,
          semanticId: panel.props.semanticId,
          x: panel.x,
          y: panel.y,
          w: panel.props.w,
          h: panel.props.h,
        }))
        this.createWorkspaceConnections(manifest, page.id, endpoints, currentTemplate)
      }
    }, { history: 'ignore' })
  }

  private chooseWorkspacePage(title: string, placement: string): TLPage {
    const editor = this.getEditor()
    const current = editor.getCurrentPage()
    const currentIsEmpty = !manifestFromPage(current) && editor.getPageShapeIds(current.id).size === 0
    if (placement === 'current-view' && currentIsEmpty) {
      editor.renamePage(current.id, title)
      return editor.getPage(current.id) ?? current
    }

    const before = new Set(editor.getPages().map((page) => page.id))
    editor.createPage({ name: title })
    const created = editor.getPages().find((page) => !before.has(page.id))
    if (!created) throw new Error('Unable to create a new tldraw page for the workspace.')
    return created
  }

  async createWorkspace(
    source: WorkspaceCreateSource,
    placement: 'new-page' | 'current-view' | 'beside-selection' = 'new-page',
    openAfterCreate = true,
  ): Promise<{
    workspaceId: string
    pageId: string
    revision: number
    templateId: string
    createdElements: string[]
    warnings: string[]
  }> {
    const editor = this.getEditor()
    let template: PromptWorkspaceTemplate
    let values: Record<string, JsonValue> = {}

    if (source.kind === 'template') {
      const found = this.library.get(source.templateId)
      if (!found) throw new Error(`Template “${source.templateId}” was not found.`)
      template = found
      values = source.values ?? {}
    } else if (source.kind === 'definition') {
      template = assertValidTemplate(source.template)
    } else {
      template = createBlankTemplate(source.title, source.prompt ?? '')
    }

    const manifest = createWorkspaceManifest(template, values)
    const mark = editor.markHistoryStoppingPoint('create prompt workspace')
    let page: TLPage | undefined
    let createdElements: string[] = []
    const warnings: string[] = []
    try {
      this.runtimeMutationDepth += 1
      editor.run(() => {
        page = this.chooseWorkspacePage(template.title, placement)
        editor.updatePage({ id: page.id, meta: pageMetaWithManifest(page, manifest) })
        const origin =
          placement === 'current-view'
            ? { x: editor.getViewportPageBounds().x, y: editor.getViewportPageBounds().y }
            : { x: 0, y: 0 }
        const panels = compileWorkspacePanels(manifest, origin)
        createdElements = panels.map((descriptor) => descriptor.semanticId)
        const panelInputs = panels.map((descriptor) =>
          this.panelShapeInput(manifest.workspaceId, page!.id, descriptor))
        editor.createShapes(panelInputs)
        this.createWorkspaceConnections(manifest, page!.id, panels.map((descriptor, index) => ({
          id: panelInputs[index].id,
          semanticId: descriptor.semanticId,
          x: descriptor.x,
          y: descriptor.y,
          w: descriptor.w,
          h: descriptor.h,
        })))
      })
      editor.squashToMark(mark)
    } catch (error) {
      editor.bailToMark(mark)
      throw error
    } finally {
      this.runtimeMutationDepth -= 1
    }

    if (!page) throw new Error('Workspace page creation did not complete.')
    if (placement === 'beside-selection' && page.id !== editor.getCurrentPageId()) {
      warnings.push('One workspace maps to one tldraw page, so the workspace was created on a new page.')
    }
    if (openAfterCreate) {
      editor.setCurrentPage(page.id)
      queueMicrotask(() => editor.zoomToFit({ animation: { duration: 180 } }))
    }
    this.activity.add({
      source: 'user',
      kind: 'workspace-created',
      summary: `Created “${manifest.title}”.`,
      workspaceId: manifest.workspaceId,
      status: 'success',
      detail: { templateId: template.id, placement },
    })
    this.refreshSnapshot()
    return {
      workspaceId: manifest.workspaceId,
      pageId: page.id,
      revision: manifest.documentRevision,
      templateId: template.id,
      createdElements,
      warnings,
    }
  }

  async duplicateWorkspace(workspaceId: string): Promise<string> {
    const { manifest } = this.findWorkspacePage(workspaceId)
    const result = await this.createWorkspace(
      { kind: 'definition', template: this.templateFromWorkspace(manifest) },
      'new-page',
      true,
    )
    return result.workspaceId
  }

  deleteWorkspace(input: {
    workspaceId: string
    expectedRevision: number
    confirmed: true
  }): {
    deletedWorkspaceId: string
    deletedPageId: string
    remainingWorkspaceCount: number
    activeWorkspaceId: string
    undoAvailable: boolean
  } {
    if (input.confirmed !== true) {
      throw new Error('Workspace deletion requires confirmed to be exactly true.')
    }

    const editor = this.getEditor()
    const target = this.findWorkspacePage(input.workspaceId)
    assertDocumentRevision(target.manifest, input.expectedRevision)

    const workspaces = this.listWorkspacePages()
    if (workspaces.length <= 1) {
      throw new Error('Cannot delete the only remaining Prompt Canvas workspace.')
    }
    const currentWorkspace = workspaces.find(
      (candidate) => candidate.page.id === editor.getCurrentPageId(),
    )
    const remaining =
      currentWorkspace?.page.id !== target.page.id
        ? currentWorkspace
        : workspaces.find((candidate) => candidate.page.id !== target.page.id)
    if (!remaining) {
      throw new Error('No remaining Prompt Canvas workspace is available to select.')
    }

    let activeWorkspace = remaining.manifest
    const mark = editor.markHistoryStoppingPoint('delete prompt workspace')
    try {
      this.runtimeMutationDepth += 1
      editor.run(() => {
        // Selecting first keeps the active page inside the managed workspace set even
        // if the document also contains unrelated tldraw pages.
        editor.setCurrentPage(remaining.page.id)
        editor.deletePage(target.page.id)
      })
      const selectedWorkspace = manifestFromPage(editor.getCurrentPage())
      if (!selectedWorkspace || selectedWorkspace.workspaceId !== remaining.manifest.workspaceId) {
        throw new Error('Workspace deletion did not leave the selected workspace active.')
      }
      activeWorkspace = selectedWorkspace
      editor.squashToMark(mark)
    } catch (error) {
      editor.bailToMark(mark)
      throw error
    } finally {
      this.runtimeMutationDepth -= 1
    }

    const remainingWorkspaceCount = this.listWorkspacePages().length
    this.activity.add({
      source: 'site-tool',
      kind: 'workspace-deleted',
      summary: `Deleted “${target.manifest.title}”.`,
      workspaceId: target.manifest.workspaceId,
      status: 'success',
      detail: {
        pageId: target.page.id,
        remainingWorkspaceCount,
        activeWorkspaceId: activeWorkspace.workspaceId,
      },
    })
    this.refreshSnapshot()
    return {
      deletedWorkspaceId: target.manifest.workspaceId,
      deletedPageId: target.page.id,
      remainingWorkspaceCount,
      activeWorkspaceId: activeWorkspace.workspaceId,
      undoAvailable: editor.canUndo(),
    }
  }

  private mutateWorkspace<T>(input: {
    workspaceId: string
    expectedRevision: number
    label: string
    generationRelevant: boolean
    apply: (context: {
      editor: Editor
      page: TLPage
      manifest: WorkspaceManifest
      nextManifest: WorkspaceManifest
    }) => T
  }): T {
    const editor = this.getEditor()
    const { page, manifest } = this.findWorkspacePage(input.workspaceId)
    assertDocumentRevision(manifest, input.expectedRevision)
    const nextManifest = nextRevision(manifest, input.generationRelevant)
    const mark = editor.markHistoryStoppingPoint(input.label)
    let result: T
    try {
      this.runtimeMutationDepth += 1
      editor.run(() => {
        result = input.apply({ editor, page, manifest, nextManifest })
        const latestPage = editor.getPage(page.id) ?? page
        editor.updatePage({ id: page.id, meta: pageMetaWithManifest(latestPage, nextManifest) })
      })
      editor.squashToMark(mark)
    } catch (error) {
      editor.bailToMark(mark)
      throw error
    } finally {
      this.runtimeMutationDepth -= 1
    }
    this.refreshSnapshot()
    return result!
  }

  async updateWorkspace(input: {
    workspaceId: string
    expectedRevision: number
    operations: WorkspaceUpdateOperation[]
    reason?: string
  }): Promise<{
    workspaceId: string
    revision: number
    generationRevision: number
    changedElements: string[]
    warnings: string[]
  }> {
    if (input.operations.length === 0 || input.operations.length > 100) {
      throw new Error('Workspace updates require between 1 and 100 operations.')
    }

    const editor = this.getEditor()
    const { manifest: initialManifest } = this.findWorkspacePage(input.workspaceId)
    assertDocumentRevision(initialManifest, input.expectedRevision)

    const resolvedReferences = new Map<number, ImportedImage>()
    for (const [index, operation] of input.operations.entries()) {
      if (operation.op !== 'attach_reference') continue
      const maxBytes = initialManifest.templateSnapshot.limits?.maxReferenceBytes
      resolvedReferences.set(
        index,
        await resolveAssetSource({
          source: operation.asset,
          registry: this.transports,
          ...(maxBytes ? { maxBytes } : {}),
        }),
      )
    }
    this.assertEditorCurrent(editor)

    const relevant = input.operations.some(generationRelevant)
    const changedElements: string[] = []
    const warnings: string[] = []
    const createdAssetIds: TLAssetId[] = []
    const storedReferences = new Map<number, TLImageAsset>()

    let result: {
      workspaceId: string
      revision: number
      generationRevision: number
      changedElements: string[]
      warnings: string[]
    }
    try {
      for (const [index, image] of resolvedReferences) {
        const operation = input.operations[index]
        if (operation?.op !== 'attach_reference') {
          throw new Error('Reference image was resolved for an invalid operation.')
        }
        const slot = initialManifest.templateSnapshot.references?.find(
          (candidate) => candidate.id === operation.slotId,
        )
        if (!slot) throw new Error(`Reference slot “${operation.slotId}” was not found.`)
        if (!mimeTypeAccepted(image.mimeType, slot.acceptedMimeTypes)) {
          throw new Error(`Reference slot “${slot.label}” does not accept ${image.mimeType}.`)
        }
        const assetId = AssetRecordType.createId()
        const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1]
        const name = sanitizeLabel(operation.label, `reference-${assetId}.${extension}`)
        createdAssetIds.push(assetId)
        storedReferences.set(
          index,
          await this.uploadLocalImage({
            editor,
            assetId,
            image,
            name,
            meta: {
              promptCanvas: {
                kind: 'reference',
                workspaceId: input.workspaceId,
                slotId: slot.id,
                byteDigest: image.byteDigest,
              },
            },
          }),
        )
      }

      this.assertEditorCurrent(editor)
      result = this.mutateWorkspace({
        workspaceId: input.workspaceId,
        expectedRevision: input.expectedRevision,
        label: input.reason ? `update: ${input.reason.slice(0, 80)}` : 'update prompt workspace',
        generationRelevant: relevant,
        apply: ({ editor, page, manifest, nextManifest }) => {
          const nextTemplate = clone(manifest.templateSnapshot)
          const nextValues = clone(manifest.controlValues)
          const activeAssetIds = new Set(this.workspaceAssetIds(input.workspaceId))
          const activeDigests = this.workspaceAssetDigests(input.workspaceId)
          const digestByAssetId = new Map(
            [...activeDigests.entries()].map(([digest, assetId]) => [assetId, digest]),
          )
          const maxWorkspaceAssets = nextTemplate.limits?.maxWorkspaceAssets ?? 120

          for (const [index, operation] of input.operations.entries()) {
            switch (operation.op) {
            case 'set_prompt_body': {
              nextTemplate.prompt.body = operation.body
              const shapes = this.panelsByPayloadKind(input.workspaceId, 'prompt')
              if (shapes.length === 0) throw new Error('Prompt panel is missing.')
              for (const shape of shapes) {
                const payload = parsePanelPayload(shape.props.payload)
                if (payload.kind !== 'prompt') throw new Error('Prompt panel has invalid data.')
                this.updatePanelPayload(shape, { ...payload, body: operation.body })
                changedElements.push(shape.props.semanticId)
              }
              break
            }
            case 'set_negative_prompt': {
              nextTemplate.prompt.negativePrompt = operation.body
              const shapes = this.panelsByPayloadKind(input.workspaceId, 'prompt')
              if (shapes.length === 0) throw new Error('Prompt panel is missing.')
              for (const shape of shapes) {
                const payload = parsePanelPayload(shape.props.payload)
                if (payload.kind !== 'prompt') throw new Error('Prompt panel has invalid data.')
                this.updatePanelPayload(shape, { ...payload, negativePrompt: operation.body })
                changedElements.push(shape.props.semanticId)
              }
              break
            }
            case 'set_variable': {
              const declared = nextTemplate.prompt.variables?.some((item) => item.id === operation.variableId)
              if (!declared) warnings.push(`Variable “${operation.variableId}” is not explicitly declared.`)
              nextValues[operation.variableId] = clone(operation.value)
              changedElements.push(`variable:${operation.variableId}`)
              break
            }
            case 'set_control': {
              const control = nextTemplate.controls?.find((item) => item.id === operation.controlId)
              if (!control) throw new Error(`Control “${operation.controlId}” was not found.`)
              const key = control.binding.mode === 'variable' ? control.binding.target : control.id
              nextValues[key] = clone(operation.value)
              changedElements.push(`control:${operation.controlId}`)
              break
            }
            case 'add_annotation': {
              const semanticId = `annotation-${Date.now().toString(36)}-${index}`
              const anchor = operation.anchorId
                ? this.panelShapes(page.id).find((shape) => shape.props.semanticId === operation.anchorId)
                : undefined
              const descriptor: PanelDescriptor = {
                semanticId,
                title: 'Note',
                kind: 'note',
                x: (anchor?.x ?? editor.getViewportPageBounds().center.x) + (anchor?.props.w ?? 0) + 36,
                y: anchor?.y ?? editor.getViewportPageBounds().center.y,
                w: 220,
                h: 140,
                payload: {
                  kind: 'note',
                  text: operation.text,
                  ...(operation.anchorId ? { anchorId: operation.anchorId } : {}),
                  tone: 'yellow',
                },
              }
              editor.createShape(this.panelShapeInput(input.workspaceId, page.id, descriptor))
              changedElements.push(semanticId)
              break
            }
            case 'move_element': {
              const { shape } = this.findPanel(input.workspaceId, operation.elementId)
              editor.updateShape({ id: shape.id, type: shape.type, x: operation.x, y: operation.y })
              changedElements.push(operation.elementId)
              break
            }
            case 'resize_element': {
              if (!(operation.width > 0 && operation.height > 0)) {
                throw new Error('Element dimensions must be positive.')
              }
              const { shape } = this.findPanel(input.workspaceId, operation.elementId)
              editor.updateShape({
                id: shape.id,
                type: shape.type,
                props: { w: operation.width, h: operation.height },
              })
              changedElements.push(operation.elementId)
              break
            }
            case 'attach_reference': {
              const image = resolvedReferences.get(index)
              if (!image) throw new Error('Reference image was not resolved.')
              const storedReference = storedReferences.get(index)
              if (!storedReference) throw new Error('Reference image was not stored.')
              const slot = nextTemplate.references?.find((candidate) => candidate.id === operation.slotId)
              if (!slot) throw new Error(`Reference slot “${operation.slotId}” was not found.`)
              if (!mimeTypeAccepted(image.mimeType, slot.acceptedMimeTypes)) {
                throw new Error(
                  `Reference slot “${slot.label}” does not accept ${image.mimeType}.`,
                )
              }
              if (activeAssetIds.size >= maxWorkspaceAssets) {
                throw new Error(
                  `Workspace asset limit of ${maxWorkspaceAssets} has been reached.`,
                )
              }
              const duplicateAssetId = activeDigests.get(image.byteDigest)
              if (duplicateAssetId) {
                throw new Error(
                  `Reference bytes duplicate existing workspace asset “${duplicateAssetId}”.`,
                )
              }
              const panel = this.panelsByPayloadKind(input.workspaceId, 'references')[0]
              if (!panel) throw new Error('Reference panel is missing.')
              const payload = parsePanelPayload(panel.props.payload)
              if (payload.kind !== 'references') throw new Error('Reference panel has invalid data.')
              const currentForSlot = payload.items.filter((item) => item.slotId === slot.id)
              if (!slot.multiple && currentForSlot.length > 0) {
                throw new Error(`Reference slot “${slot.label}” accepts only one image.`)
              }
              if (slot.maxItems && currentForSlot.length >= slot.maxItems) {
                throw new Error(`Reference slot “${slot.label}” is full.`)
              }
              const assetId = storedReference.id
              editor.createAssets([storedReference])
              activeAssetIds.add(assetId)
              activeDigests.set(image.byteDigest, assetId)
              digestByAssetId.set(assetId, image.byteDigest)
              const item: ReferenceAsset & { label?: string } = {
                assetId,
                slotId: slot.id,
                purpose: slot.role,
                mimeType: image.mimeType,
                width: image.width,
                height: image.height,
                required: Boolean(slot.required),
                ...(operation.label ? { label: operation.label } : {}),
              }
              this.updatePanelPayload(panel, { ...payload, items: [...payload.items, item] })
              changedElements.push(panel.props.semanticId)
              break
            }
            case 'remove_reference': {
              const panel = this.panelsByPayloadKind(input.workspaceId, 'references')[0]
              if (!panel) throw new Error('Reference panel is missing.')
              const payload = parsePanelPayload(panel.props.payload)
              if (payload.kind !== 'references') throw new Error('Reference panel has invalid data.')
              const exists = payload.items.some((item) => item.assetId === operation.referenceId)
              if (!exists) throw new Error(`Reference “${operation.referenceId}” was not found.`)
              this.updatePanelPayload(panel, {
                ...payload,
                items: payload.items.filter((item) => item.assetId !== operation.referenceId),
              })
              activeAssetIds.delete(operation.referenceId)
              const removedDigest = digestByAssetId.get(operation.referenceId)
              if (removedDigest && activeDigests.get(removedDigest) === operation.referenceId) {
                activeDigests.delete(removedDigest)
              }
              digestByAssetId.delete(operation.referenceId)
              // Keep the unreferenced asset record so tldraw undo can restore the panel reference.
              // A future compactor may purge unreachable local assets outside the edit transaction.
              changedElements.push(panel.props.semanticId)
              break
            }
            case 'set_workflow_stage': {
              const panel = this.panelsByPayloadKind(input.workspaceId, 'workflow')[0]
              if (!panel) throw new Error('Workflow panel is missing.')
              const payload = parsePanelPayload(panel.props.payload)
              if (payload.kind !== 'workflow') throw new Error('Workflow panel has invalid data.')
              if (!payload.workflow.stages.some((stage) => stage.id === operation.stageId)) {
                throw new Error(`Workflow stage “${operation.stageId}” was not found.`)
              }
              this.updatePanelPayload(panel, {
                ...payload,
                statuses: { ...payload.statuses, [operation.stageId]: operation.status },
              })
              changedElements.push(panel.props.semanticId)
              break
            }
            }
          }

          nextManifest.templateSnapshot = nextTemplate
          nextManifest.controlValues = nextValues
          nextManifest.generationState = relevant ? 'empty' : manifest.generationState
          delete nextManifest.latestGenerationRequestId

          for (const panel of this.panelsByPayloadKind(input.workspaceId, 'controls')) {
            const payload = parsePanelPayload(panel.props.payload)
            if (payload.kind === 'controls') {
              this.updatePanelPayload(panel, { ...payload, values: clone(nextValues) })
            }
          }

          return {
            workspaceId: input.workspaceId,
            revision: nextManifest.documentRevision,
            generationRevision: nextManifest.generationRevision,
            changedElements: uniqueStrings(changedElements),
            warnings,
          }
        },
      })
    } catch (error) {
      if (createdAssetIds.length > 0) {
        try {
          await this.removeLocalImages(editor, createdAssetIds)
        } catch {
          // Preserve the original transaction error; unreachable assets are safe local orphans.
        }
      }
      throw error
    }

    this.activity.add({
      source: 'site-tool',
      kind: 'workspace-updated',
      summary: input.reason ?? `Applied ${input.operations.length} workspace operation(s).`,
      workspaceId: input.workspaceId,
      status: 'success',
      detail: { operations: input.operations.map((operation) => operation.op) },
    })
    return result
  }

  setControlFromUi(workspaceId: string, controlId: string, value: JsonValue): Promise<unknown> {
    const { manifest } = this.findWorkspacePage(workspaceId)
    return this.updateWorkspace({
      workspaceId,
      expectedRevision: manifest.documentRevision,
      operations: [{ op: 'set_control', controlId, value }],
      reason: `Changed ${controlId}`,
    })
  }

  inspect(input: {
    workspaceId?: string
    include?: string[]
    maxItems?: number
  } = {}): JsonObject {
    const editor = this.getEditor()
    const selectedWorkspace = input.workspaceId
      ? this.findWorkspacePage(input.workspaceId)
      : manifestFromPage(editor.getCurrentPage())
        ? { page: editor.getCurrentPage(), manifest: manifestFromPage(editor.getCurrentPage())! }
        : this.listWorkspacePages()[0]
    if (!selectedWorkspace) {
      return {
        app: 'Prompt Canvas',
        version: APP_VERSION,
        activeWorkspace: null,
        verifiedAssetTransports: this.transports.getVerified(),
        warnings: ['No workspace is open.'],
      }
    }

    const { page, manifest } = selectedWorkspace
    const maxItems = Math.max(1, Math.min(input.maxItems ?? 50, 200))
    const include = new Set(input.include ?? ['prompt', 'controls', 'references', 'outputs', 'selection', 'workflow'])
    const panels = this.panelShapes(page.id)
    const result: JsonObject = {
      app: 'Prompt Canvas',
      version: APP_VERSION,
      workspace: {
        workspaceId: manifest.workspaceId,
        pageId: page.id,
        title: manifest.title,
        templateId: manifest.templateId ?? null,
        documentRevision: manifest.documentRevision,
        generationRevision: manifest.generationRevision,
        generationState: manifest.generationState,
      },
      revision: manifest.documentRevision,
      generationRevision: manifest.generationRevision,
      verifiedAssetTransports: this.transports.getVerified(),
      capabilities: {
        generationOperations: manifest.templateSnapshot.generation.operations,
        pageTools: webmcpCatalog.tools.map((tool) => tool.name),
      },
      limits: {
        maxItems,
        maxGeneratedAssetBytes:
          manifest.templateSnapshot.limits?.maxGeneratedAssetBytes ?? 12 * 1024 * 1024,
        maxWorkspaceAssets: manifest.templateSnapshot.limits?.maxWorkspaceAssets ?? 120,
      },
    }

    if (include.has('prompt')) {
      result.prompt = canonicalPromptPayload(manifest) as unknown as JsonValue
    }
    if (include.has('controls')) {
      result.controls = {
        values: manifest.controlValues,
        definitions: manifest.templateSnapshot.controls?.slice(0, maxItems) ?? [],
      } as unknown as JsonValue
    }
    if (include.has('references')) {
      result.references = this.referenceAssets(manifest.workspaceId).slice(0, maxItems) as unknown as JsonValue
    }
    if (include.has('outputs')) {
      result.outputs = this.outputSummary(manifest.workspaceId, maxItems) as unknown as JsonValue
    }
    if (include.has('workflow')) {
      const workflow = panels
        .map((shape) => parsePanelPayload(shape.props.payload))
        .find((payload) => payload.kind === 'workflow')
      result.workflow = (workflow ?? null) as unknown as JsonValue
    }
    if (include.has('activity')) {
      result.activity = this.activity.getEntries(manifest.workspaceId).slice(0, maxItems) as unknown as JsonValue
    }
    if (include.has('selection')) {
      result.selection = {
        semanticIds: editor
          .getSelectedShapes()
          .filter(isPanelShape)
          .filter((shape) => shape.props.workspaceId === manifest.workspaceId)
          .map((shape) => shape.props.semanticId)
          .slice(0, maxItems),
      }
    }
    result.elements = panels.slice(0, maxItems).map((shape) => ({
      semanticId: shape.props.semanticId,
      kind: shape.props.kind,
      title: shape.props.title,
      x: shape.x,
      y: shape.y,
      width: shape.props.w,
      height: shape.props.h,
      locked: shape.isLocked,
    })) as unknown as JsonValue
    return result
  }

  listTemplates(input: {
    query?: string
    categories?: string[]
    families?: string[]
    capabilities?: string[]
    limit?: number
  } = {}): JsonObject {
    const limit = Math.max(1, Math.min(input.limit ?? 40, 100))
    const records = this.library
      .search(input.query ?? '')
      .filter(({ entry }) => !input.categories?.length || input.categories.includes(entry.category))
      .filter(({ entry }) => !input.families?.length || input.families.includes(entry.family))
      .filter(
        ({ entry }) =>
          !input.capabilities?.length ||
          input.capabilities.every((capability) => entry.capabilities.includes(capability as never)),
      )
      .slice(0, limit)
    return {
      total: records.length,
      nextCursor: null,
      templates: records.map(({ entry, template }) => ({
        ...entry,
        version: template.version,
        source: template.source ?? null,
        referenceCount: template.references?.length ?? 0,
        controlCount: template.controls?.length ?? 0,
        workflowMode: template.workflow?.mode ?? null,
        outputCount: template.outputs.length,
      })) as unknown as JsonValue,
    }
  }

  getTemplate(templateId: string, version?: number): PromptWorkspaceTemplate {
    const template = this.library.get(templateId, version)
    if (!template) throw new Error(`Template “${templateId}” was not found.`)
    return template
  }

  validateTemplate(candidate: unknown, mode: 'schema-only' | 'compatibility' | 'full'): TemplateValidationResult {
    return validateTemplate(candidate, mode)
  }

  getGenerationContext(input: {
    workspaceId: string
    operation: GenerationOperation
    outputSlotId?: string
    selectedOutputIds?: string[]
    chatDirection?: string
  }): GenerationContext {
    const { page, manifest } = this.findWorkspacePage(input.workspaceId)
    const promptPayload = canonicalPromptPayload(manifest)

    const selection = resolveOutputSelection({
      workspaceId: input.workspaceId,
      allowedAssetIds: this.outputAssetIds(input.workspaceId),
      selectedPanels: this.getEditor().getSelectedShapes().filter(isPanelShape).map((shape) => {
        const payload = parsePanelPayload(shape.props.payload)
        return {
          workspaceId: shape.props.workspaceId,
          semanticId: shape.props.semanticId,
          assetIds: payload.kind === 'output' || payload.kind === 'variations' ? payload.assetIds : [],
        }
      }),
      ...(input.selectedOutputIds !== undefined ? { requestedAssetIds: input.selectedOutputIds } : {}),
    })

    const workflowPanel = this.panelShapes(page.id)
      .map((shape) => {
        try {
          return parsePanelPayload(shape.props.payload)
        } catch {
          return undefined
        }
      })
      .find((payload) => payload?.kind === 'workflow')

    const context = resolveGenerationContext({
      manifest,
      template: manifest.templateSnapshot,
      rawPrompt: promptPayload.body,
      controlValues: manifest.controlValues,
      references: this.referenceAssets(input.workspaceId),
      operation: input.operation,
      ...(input.outputSlotId ? { targetOutputId: input.outputSlotId } : {}),
      selection,
      ...(workflowPanel?.kind === 'workflow'
        ? { workflowStatuses: workflowPanel.statuses }
        : {}),
      verifiedAssetTransports: this.transports.getVerified(),
      requestId: createGenerationRequestId(),
      ...(input.chatDirection ? { chatDirection: input.chatDirection } : {}),
    })
    this.pendingContexts.set(context.requestId, clone(context))
    return context
  }

  prepareGenerationFromUi(input: {
    workspaceId: string
    operation?: GenerationOperation
    outputSlotId?: string
  }): GenerationContext {
    const { manifest } = this.findWorkspacePage(input.workspaceId)
    const operation = resolveGenerationOperation({
      template: manifest.templateSnapshot,
      requested: input.operation,
      targetOutputId: input.outputSlotId,
    })
    const context = this.getGenerationContext({
      workspaceId: input.workspaceId,
      operation,
      ...(input.outputSlotId ? { outputSlotId: input.outputSlotId } : {}),
    })
    this.snapshot = { ...this.snapshot, preparedContext: context }
    this.activity.add({
      source: 'user',
      kind: 'generation-context-prepared',
      summary: `Prepared ${operation} context for Codex.`,
      workspaceId: input.workspaceId,
      status: 'success',
      detail: { requestId: context.requestId, outputSlotId: context.targetOutputId },
    })
    this.emit()
    return context
  }

  async addGeneratedAssets(input: {
    workspaceId: string
    requestId: string
    generationRevision: number
    assets: GeneratedAssetInput[]
  }): Promise<JsonObject> {
    if (input.assets.length === 0 || input.assets.length > DEFAULT_MAX_IMAGES_PER_IMPORT) {
      throw new Error(`Import between 1 and ${DEFAULT_MAX_IMAGES_PER_IMPORT} images per call.`)
    }
    if (this.consumedRequestIds.has(input.requestId)) {
      throw new Error(`Generation request “${input.requestId}” has already been consumed.`)
    }
    const editor = this.getEditor()
    const context = this.pendingContexts.get(input.requestId)
    if (!context || context.workspaceId !== input.workspaceId) {
      throw new Error('Generation request is unknown or belongs to another workspace.')
    }
    const { manifest } = this.findWorkspacePage(input.workspaceId)
    assertGenerationRevision(manifest, input.generationRevision)
    if (context.generationRevision !== input.generationRevision) {
      throw new Error('Returned assets do not match the prepared generation context.')
    }

    const outputSlot = manifest.templateSnapshot.outputs.find(
      (candidate) => candidate.id === context.targetOutputId,
    )
    if (!outputSlot) {
      throw new Error(`Prepared output slot “${context.targetOutputId}” no longer exists.`)
    }
    if (outputSlot.kind !== 'image' && outputSlot.kind !== 'image-set') {
      throw new Error(`Output slot “${outputSlot.label}” does not accept image assets.`)
    }
    if (outputSlot.operations?.length && !outputSlot.operations.includes(context.operation)) {
      throw new Error(
        `Prepared operation “${context.operation}” is not allowed for output “${outputSlot.label}”.`,
      )
    }
    if (input.assets.length > context.outputRequirements.requestedCount) {
      throw new Error(
        `Generation context requested at most ${context.outputRequirements.requestedCount} image${context.outputRequirements.requestedCount === 1 ? '' : 's'}.`,
      )
    }

    const existingAssetIds = new Set(this.workspaceAssetIds(input.workspaceId))
    const maxWorkspaceAssets = manifest.templateSnapshot.limits?.maxWorkspaceAssets ?? 120
    if (existingAssetIds.size + input.assets.length > maxWorkspaceAssets) {
      throw new Error(
        `Import would exceed the workspace asset limit of ${maxWorkspaceAssets}.`,
      )
    }

    const semanticRejections: Array<{ index: number; reason: string }> = []
    for (const [index, asset] of input.assets.entries()) {
      if (asset.outputSlotId !== context.targetOutputId) {
        semanticRejections.push({
          index,
          reason: `Asset targets “${asset.outputSlotId}”, but the prepared context targets “${context.targetOutputId}”.`,
        })
      }
      if (asset.operation !== context.operation) {
        semanticRejections.push({
          index,
          reason: `Asset operation “${asset.operation}” does not match prepared operation “${context.operation}”.`,
        })
      }
      if (asset.operation !== 'generate' && !asset.parentAssetIds?.length) {
        semanticRejections.push({
          index,
          reason: `Derived ${asset.operation} assets require at least one parent asset for lineage.`,
        })
      }
      if (asset.promptDigest !== context.promptDigest) {
        semanticRejections.push({
          index,
          reason: `Asset prompt digest does not match prepared digest “${context.promptDigest}”.`,
        })
      }
      for (const parentAssetId of asset.parentAssetIds ?? []) {
        if (!existingAssetIds.has(parentAssetId)) {
          semanticRejections.push({
            index,
            reason: `Parent asset “${parentAssetId}” is not reachable from this workspace.`,
          })
        }
      }
    }
    if (semanticRejections.length > 0) {
      return {
        workspaceId: input.workspaceId,
        revision: manifest.documentRevision,
        assetIds: [],
        placements: [],
        rejectedAssets: semanticRejections,
        lineage: [],
        atomic: true,
        message: 'No assets were imported because the batch did not match its generation context.',
      }
    }

    const maxBytes = manifest.templateSnapshot.limits?.maxGeneratedAssetBytes
    const prepared: PreparedAsset[] = []
    const rejected: Array<{ index: number; reason: string }> = []
    const activeDigests = this.workspaceAssetDigests(input.workspaceId)
    const batchDigests = new Set<string>()
    for (const [index, asset] of input.assets.entries()) {
      try {
        const image = await resolveAssetSource({
          source: asset.source,
          registry: this.transports,
          declaredMimeType: asset.mimeType,
          ...(maxBytes ? { maxBytes } : {}),
        })
        const duplicateAssetId = activeDigests.get(image.byteDigest)
        if (duplicateAssetId) {
          throw new Error(
            `Generated bytes duplicate existing workspace asset “${duplicateAssetId}”.`,
          )
        }
        if (batchDigests.has(image.byteDigest)) {
          throw new Error('Generated bytes duplicate another image in this import batch.')
        }
        batchDigests.add(image.byteDigest)
        prepared.push({
          image,
          ...(asset.label ? { label: asset.label } : {}),
          outputSlotId: asset.outputSlotId,
          operation: asset.operation,
          parentAssetIds: asset.parentAssetIds ?? [],
          promptDigest: asset.promptDigest,
        })
      } catch (error) {
        rejected.push({ index, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    if (rejected.length > 0) {
      return {
        workspaceId: input.workspaceId,
        revision: manifest.documentRevision,
        assetIds: [],
        placements: [],
        rejectedAssets: rejected,
        lineage: [],
        atomic: true,
        message: 'No assets were imported because one or more payloads failed validation.',
      }
    }

    this.assertEditorCurrent(editor)

    const outputPanel = this.findOutputPanel(input.workspaceId, context.targetOutputId)
    const outputPayload = parsePanelPayload(outputPanel.props.payload)
    if (outputPayload.kind !== 'output' && outputPayload.kind !== 'variations') {
      throw new Error('Output panel has invalid data.')
    }

    const assetIds: string[] = []
    const createdAssetIds: TLAssetId[] = []
    const placements: JsonValue[] = []
    const lineage: GeneratedAssetProvenance[] = []
    const storedAssets: Array<{
      record: TLImageAsset
      provenance: GeneratedAssetProvenance
    }> = []
    let result: JsonObject
    try {
      for (const [index, item] of prepared.entries()) {
        const assetId = AssetRecordType.createId()
        const name = sanitizeLabel(
          item.label,
          `codex-${assetId}.${item.image.mimeType.split('/')[1]}`,
        )
        const provenance: GeneratedAssetProvenance = {
          schema: 'prompt-canvas.asset-provenance@1',
          assetId,
          workspaceId: input.workspaceId,
          outputSlotId: item.outputSlotId,
          provider: 'codex',
          operation: item.operation,
          requestId: input.requestId,
          generationRevision: input.generationRevision,
          parentAssetIds: clone(item.parentAssetIds),
          mimeType: item.image.mimeType,
          width: item.image.width,
          height: item.image.height,
          byteLength: item.image.byteLength,
          byteDigest: item.image.byteDigest,
          createdAt: new Date().toISOString(),
          promoted: outputSlot.role === 'primary' && index === 0,
          ...(item.label ? { label: item.label } : {}),
          promptDigest: item.promptDigest,
        }
        createdAssetIds.push(assetId)
        const record = await this.uploadLocalImage({
          editor,
          assetId,
          image: item.image,
          name,
          meta: { promptCanvas: provenance as unknown as JsonValue },
        })
        storedAssets.push({ record, provenance })
        assetIds.push(assetId)
        lineage.push(provenance)
      }

      this.assertEditorCurrent(editor)
      result = this.mutateWorkspace({
        workspaceId: input.workspaceId,
        expectedRevision: manifest.documentRevision,
        label: 'import Codex generated assets',
        generationRelevant: false,
        apply: ({ editor, nextManifest }) => {
          editor.createAssets(storedAssets.map(({ record }) => record))
          const appended = uniqueStrings([
            ...outputPayload.assetIds,
            ...storedAssets.map(({ record }) => record.id),
          ])
          const promotedAssetId =
            outputPayload.promotedAssetId ??
            (outputPayload.slot.role === 'primary' ? storedAssets[0]?.record.id : undefined)
          const labels = { ...(outputPayload.labels ?? {}) }
          for (const { record, provenance } of storedAssets) {
            if (provenance.label) labels[record.id] = provenance.label
          }
          this.updatePanelPayload(outputPanel, {
            ...outputPayload,
            assetIds: appended,
            ...(Object.keys(labels).length ? { labels } : {}),
            ...(promotedAssetId ? { promotedAssetId } : {}),
          })
          for (const [index, { record }] of storedAssets.entries()) {
            placements.push({
              assetId: record.id,
              panelId: outputPanel.props.semanticId,
              slotId: context.targetOutputId,
              index: outputPayload.assetIds.length + index,
            })
          }

          nextManifest.generationState = 'complete'
          nextManifest.latestGenerationRequestId = input.requestId
          return {
            workspaceId: input.workspaceId,
            revision: nextManifest.documentRevision,
            assetIds,
            placements,
            rejectedAssets: [],
            lineage,
            atomic: true,
          }
        },
      }) as JsonObject
    } catch (error) {
      if (createdAssetIds.length > 0) {
        try {
          await this.removeLocalImages(editor, createdAssetIds)
        } catch {
          // Preserve the original transaction error; unreachable assets are safe local orphans.
        }
      }
      throw error
    }

    this.consumedRequestIds.add(input.requestId)
    this.pendingContexts.delete(input.requestId)
    this.activity.add({
      source: 'codex-host',
      kind: 'generated-assets-imported',
      summary: `Imported ${assetIds.length} Codex-generated image${assetIds.length === 1 ? '' : 's'}.`,
      workspaceId: input.workspaceId,
      status: 'success',
      detail: { requestId: input.requestId, assetIds },
    })
    return result
  }

  manageOutputs(input: {
    workspaceId: string
    expectedRevision: number
    operations: OutputManagementOperation[]
  }): JsonObject {
    if (input.operations.length === 0 || input.operations.length > 50) {
      throw new Error('Output management requires between 1 and 50 operations.')
    }

    // Validate and resolve the complete batch before entering tldraw history. A throw from
    // inside editor.run is deliberately annotated by tldraw as crash-worthy, which would
    // leave the canvas error boundary active even after bailToMark restored the records.
    const { manifest } = this.findWorkspacePage(input.workspaceId)
    assertDocumentRevision(manifest, input.expectedRevision)
    const panels = this.outputPanels(input.workspaceId)
    const payloads = new Map<TLShapeId, OutputPanelPayload>()
    for (const panel of panels) {
      const payload = parsePanelPayload(panel.props.payload)
      if (payload.kind === 'output' || payload.kind === 'variations') payloads.set(panel.id, payload)
    }

    const affected = new Set<string>()
    const deletedAssetIds = new Set<string>()
    const locate = (assetId: string) => {
      for (const panel of panels) {
        const payload = payloads.get(panel.id)
        if (payload?.assetIds.includes(assetId)) return { panel, payload }
      }
      return undefined
    }

    for (const operation of input.operations) {
      if (operation.op === 'promote') {
        const located = locate(operation.assetId)
        if (!located) throw new Error(`Output asset “${operation.assetId}” was not found.`)
        const target = operation.slotId
          ? panels.find((panel) => payloads.get(panel.id)?.slot.id === operation.slotId)
          : panels.find((panel) => payloads.get(panel.id)?.slot.role === 'primary') ?? located.panel
        if (!target) throw new Error('Primary output panel is missing.')
        const payload = payloads.get(target.id)!
        payloads.set(target.id, {
          ...payload,
          assetIds: uniqueStrings([...payload.assetIds, operation.assetId]),
          promotedAssetId: operation.assetId,
        })
        affected.add(operation.assetId)
      } else if (operation.op === 'compare') {
        for (const assetId of operation.assetIds) {
          if (!locate(assetId)) throw new Error(`Output asset “${assetId}” was not found.`)
        }
        const target = panels.find((panel) => payloads.get(panel.id)?.kind === 'variations') ?? panels[0]
        if (!target) throw new Error('Output panel is missing.')
        payloads.set(target.id, { ...payloads.get(target.id)!, compareAssetIds: uniqueStrings(operation.assetIds) })
        operation.assetIds.forEach((assetId) => affected.add(assetId))
      } else if (operation.op === 'reorder') {
        const target = panels.find((panel) => payloads.get(panel.id)?.slot.id === operation.slotId)
        if (!target) throw new Error(`Output slot “${operation.slotId}” was not found.`)
        const payload = payloads.get(target.id)!
        if (operation.assetIds.some((assetId) => !payload.assetIds.includes(assetId))) {
          throw new Error('Reorder list contains an asset outside the target output slot.')
        }
        const remainder = payload.assetIds.filter((assetId) => !operation.assetIds.includes(assetId))
        payloads.set(target.id, { ...payload, assetIds: [...operation.assetIds, ...remainder] })
        operation.assetIds.forEach((assetId) => affected.add(assetId))
      } else if (operation.op === 'archive') {
        for (const assetId of operation.assetIds) {
          if (!locate(assetId)) throw new Error(`Output asset “${assetId}” was not found.`)
          for (const [panelId, payload] of payloads) {
            payloads.set(panelId, archiveOutputAsset(payload, assetId))
          }
          affected.add(assetId)
        }
      } else if (operation.op === 'label') {
        const located = locate(operation.assetId)
        if (!located) throw new Error(`Output asset “${operation.assetId}” was not found.`)
        payloads.set(located.panel.id, {
          ...located.payload,
          labels: { ...(located.payload.labels ?? {}), [operation.assetId]: operation.label },
        })
        affected.add(operation.assetId)
      } else if (operation.op === 'delete') {
        for (const assetId of operation.assetIds) {
          if (!locate(assetId)) throw new Error(`Output asset “${assetId}” was not found.`)
          for (const [panelId, payload] of payloads) {
            payloads.set(panelId, {
              ...payload,
              assetIds: payload.assetIds.filter((id) => id !== assetId),
              archivedAssetIds: payload.archivedAssetIds?.filter((id) => id !== assetId),
              compareAssetIds: payload.compareAssetIds?.filter((id) => id !== assetId),
              ...(payload.promotedAssetId === assetId ? { promotedAssetId: undefined } : {}),
            })
          }
          // Visible deletion is undoable because the asset record remains locally available.
          affected.add(assetId)
          deletedAssetIds.add(assetId)
        }
      }
    }

    if (deletedAssetIds.size > 0) {
      const cleanupPanel = panels[0]
      const payload = cleanupPanel ? payloads.get(cleanupPanel.id) : undefined
      if (cleanupPanel && payload) {
        payloads.set(cleanupPanel.id, {
          ...payload,
          pendingAssetCleanupIds: uniqueStrings([
            ...(payload.pendingAssetCleanupIds ?? []),
            ...deletedAssetIds,
          ]),
        })
      }
    }

    const result = this.mutateWorkspace({
      workspaceId: input.workspaceId,
      expectedRevision: input.expectedRevision,
      label: 'manage generated outputs',
      generationRelevant: false,
      apply: ({ nextManifest }) => {
        for (const panel of panels) {
          const payload = payloads.get(panel.id)
          if (payload) this.updatePanelPayload(panel, payload)
        }
        nextManifest.generationState = [...payloads.values()].some((payload) => payload.assetIds.length > 0) ? 'complete' : 'empty'
        if (deletedAssetIds.size > 0) {
          nextManifest.pendingAssetCleanupIds = uniqueStrings([
            ...(nextManifest.pendingAssetCleanupIds ?? []),
            ...deletedAssetIds,
          ])
        }
        return {
          workspaceId: input.workspaceId,
          revision: nextManifest.documentRevision,
          affectedAssetIds: [...affected],
          warnings: [],
          outputs: [...payloads.values()].map((payload) => ({
            slotId: payload.slot.id,
            assetIds: payload.assetIds,
            promotedAssetId: payload.promotedAssetId ?? null,
            archivedAssetIds: payload.archivedAssetIds ?? [],
            compareAssetIds: payload.compareAssetIds ?? [],
          })),
        }
      },
    })
    this.activity.add({
      source: 'site-tool',
      kind: 'outputs-managed',
      summary: `Applied ${input.operations.length} output operation(s).`,
      workspaceId: input.workspaceId,
      status: 'success',
    })
    return result
  }

  async saveTemplate(input: {
    source: { kind: 'workspace'; workspaceId: string } | { kind: 'definition'; template: unknown }
    title?: string
    mode: SaveTemplateMode
    expectedTemplateVersion?: number
  }): Promise<JsonObject> {
    const template =
      input.source.kind === 'workspace'
        ? this.templateFromWorkspace(this.findWorkspacePage(input.source.workspaceId).manifest)
        : assertValidTemplate(input.source.template)
    const saved = await this.library.save({
      template,
      mode: input.mode,
      ...(input.title ? { title: input.title } : {}),
      ...(input.expectedTemplateVersion !== undefined
        ? { expectedTemplateVersion: input.expectedTemplateVersion }
        : {}),
    })
    this.activity.add({
      source: 'site-tool',
      kind: 'template-saved',
      summary: `Saved “${saved.template.title}” to the local template library.`,
      status: 'success',
      detail: { templateId: saved.template.id, version: saved.template.version, mode: input.mode },
    })
    this.refreshSnapshot()
    return {
      templateId: saved.template.id,
      version: saved.template.version,
      validation: saved.validation as unknown as JsonValue,
      libraryEntry: {
        title: saved.template.title,
        category: saved.template.category ?? 'user-library',
        family: saved.template.compatibility?.templateFamily ?? 'open',
      },
    }
  }

  templateFromWorkspace(manifest: WorkspaceManifest): PromptWorkspaceTemplate {
    const template = clone(manifest.templateSnapshot)
    template.title = manifest.title
    template.prompt.variables = template.prompt.variables?.map((variable) => {
      const value = manifest.controlValues[variable.id]
      return value === undefined ? variable : { ...variable, defaultValue: clone(value) }
    })
    template.controls = template.controls?.map((control) => {
      const key = control.binding.mode === 'variable' ? control.binding.target : control.id
      const value = manifest.controlValues[key]
      return value === undefined ? control : { ...control, defaultValue: clone(value) }
    })
    template.status = 'draft'
    return template
  }

  private referenceAssets(workspaceId: string): ReferenceAsset[] {
    const panel = this.panelsByPayloadKind(workspaceId, 'references')[0]
    if (!panel) return []
    const payload = parsePanelPayload(panel.props.payload)
    return payload.kind === 'references' ? clone(payload.items) : []
  }

  private outputPanels(workspaceId: string): PromptCanvasPanelShape[] {
    return [
      ...this.panelsByPayloadKind(workspaceId, 'output'),
      ...this.panelsByPayloadKind(workspaceId, 'variations'),
    ]
  }

  private findOutputPanel(workspaceId: string, slotId: string): PromptCanvasPanelShape {
    const panel = this.outputPanels(workspaceId).find((shape) => {
      const payload = parsePanelPayload(shape.props.payload)
      return (payload.kind === 'output' || payload.kind === 'variations') && payload.slot.id === slotId
    })
    if (!panel) throw new Error(`Output panel for slot “${slotId}” was not found.`)
    return panel
  }

  private workspaceAssetIds(workspaceId: string): string[] {
    return uniqueStrings([
      ...this.referenceAssets(workspaceId).map((reference) => reference.assetId),
      ...this.outputAssetIds(workspaceId),
    ])
  }

  private workspaceAssetDigests(workspaceId: string): Map<string, string> {
    const digests = new Map<string, string>()
    const editor = this.getEditor()
    for (const assetId of this.workspaceAssetIds(workspaceId)) {
      const asset = editor.getAsset(assetId as TLAssetId)
      const promptCanvas = asset?.meta?.promptCanvas
      if (!promptCanvas || typeof promptCanvas !== 'object') continue
      const digest = (promptCanvas as { byteDigest?: unknown }).byteDigest
      if (typeof digest === 'string' && digest) digests.set(digest, assetId)
    }
    return digests
  }

  private outputAssetIds(workspaceId: string): string[] {
    return uniqueStrings(
      this.outputPanels(workspaceId).flatMap((shape) => {
        const payload = parsePanelPayload(shape.props.payload)
        if (payload.kind !== 'output' && payload.kind !== 'variations') return []
        return [
          ...payload.assetIds,
          ...(payload.archivedAssetIds ?? []),
          ...(payload.compareAssetIds ?? []),
          ...(payload.promotedAssetId ? [payload.promotedAssetId] : []),
        ]
      }),
    )
  }

  private outputSummary(workspaceId: string, maxItems: number): JsonValue[] {
    return this.outputPanels(workspaceId).flatMap((shape): JsonValue[] => {
      const payload = parsePanelPayload(shape.props.payload)
      if (payload.kind !== 'output' && payload.kind !== 'variations') return []
      return [
        {
          semanticId: shape.props.semanticId,
          slot: clone(payload.slot) as unknown as JsonValue,
          assetIds: payload.assetIds.slice(0, maxItems),
          promotedAssetId: payload.promotedAssetId ?? null,
          archivedAssetIds: payload.archivedAssetIds?.slice(0, maxItems) ?? [],
          compareAssetIds: payload.compareAssetIds?.slice(0, maxItems) ?? [],
          labels: payload.labels ?? {},
        } as unknown as JsonValue,
      ]
    })
  }

  private bindPanelActions(): () => void {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PanelActionDetail>).detail
      if (!detail) return
      this.panelActionChain = this.panelActionChain.then(async () => {
        try {
          if (detail.type === 'set-control-values') {
            await this.setControlFromUi(detail.workspaceId, detail.controlId, detail.value)
          } else if (detail.type === 'workspace-update') {
            const { manifest } = this.findWorkspacePage(detail.workspaceId)
            await this.updateWorkspace({
              workspaceId: detail.workspaceId,
              expectedRevision: manifest.documentRevision,
              operations: [detail.operation],
            })
          } else if (detail.type === 'manage-output') {
            const { manifest } = this.findWorkspacePage(detail.workspaceId)
            this.manageOutputs({
              workspaceId: detail.workspaceId,
              expectedRevision: manifest.documentRevision,
              operations: [detail.operation],
            })
          } else {
            this.prepareGenerationFromUi({
              workspaceId: detail.workspaceId,
              ...(detail.operation ? { operation: detail.operation } : {}),
              ...(detail.outputSlotId ? { outputSlotId: detail.outputSlotId } : {}),
            })
          }
        } catch (error) {
          this.setLastError(error)
          this.activity.add({
            source: 'user',
            kind: 'panel-action-failed',
            summary: error instanceof Error ? error.message : String(error),
            workspaceId: detail.workspaceId,
            status: 'error',
          })
        }
      })
    }
    window.addEventListener(PANEL_ACTION_EVENT, handler)
    return () => window.removeEventListener(PANEL_ACTION_EVENT, handler)
  }

  private bindStoreChanges(editor: Editor): () => void {
    return editor.store.listen(
      (entry) => {
        this.refreshSnapshot()
        if (this.runtimeMutationDepth > 0) return
        const records: unknown[] = [
          ...Object.values(entry.changes.added),
          ...Object.values(entry.changes.updated).map((pair) => pair[1]),
          ...Object.values(entry.changes.removed),
        ]
        const pageChanged = records.some(
          (record) =>
            Boolean(record) &&
            typeof record === 'object' &&
            (record as { typeName?: unknown }).typeName === 'page',
        )
        const panelChanged = records.some(
          (record) =>
            Boolean(record) &&
            typeof record === 'object' &&
            (record as { typeName?: unknown }).typeName === 'shape' &&
            (record as { type?: unknown }).type === PROMPT_CANVAS_PANEL_TYPE,
        )
        if (panelChanged && !pageChanged) this.scheduleManualRevisionBump()
      },
      { source: 'user', scope: 'document' },
    )
  }

  private scheduleManualRevisionBump(): void {
    if (this.manualRevisionScheduled) return
    this.manualRevisionScheduled = true
    queueMicrotask(() => {
      this.manualRevisionScheduled = false
      const editor = this.editor
      if (!editor) return
      const page = editor.getCurrentPage()
      const manifest = manifestFromPage(page)
      if (!manifest) return
      const next = nextRevision(manifest, false)
      editor.run(
        () => editor.updatePage({ id: page.id, meta: pageMetaWithManifest(page, next) }),
        { history: 'ignore' },
      )
      this.refreshSnapshot()
    })
  }
}
