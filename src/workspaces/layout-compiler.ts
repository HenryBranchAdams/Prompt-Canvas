import type {
  NotePanelPayload,
  OutputPanelPayload,
  PanelDescriptor,
  PanelKind,
  PanelPayload,
  PromptWorkspaceTemplate,
  WorkspaceBlock,
  WorkspaceManifest,
} from './types.js'

export type WorkspaceConnectionDescriptor = {
  sourceSemanticId: string
  targetSemanticId: string
}

const GAP = 32
const LEFT_X = 80
const TOP_Y = 80

function outputPayload(
  template: PromptWorkspaceTemplate,
  sourceId: string | undefined,
  kind: 'output' | 'variations',
): OutputPanelPayload {
  const role = kind === 'variations' ? 'variation' : 'primary'
  const slot =
    (sourceId ? template.outputs.find((output) => output.id === sourceId) : undefined) ??
    template.outputs.find((output) => output.role === role) ??
    template.outputs[0]
  if (!slot) throw new Error('A prompt workspace must declare at least one output slot.')
  const supportedOperations = (slot.operations?.length
    ? slot.operations
    : template.generation.operations
  ).filter((operation) => template.generation.operations.includes(operation))
  return {
    kind,
    slot: structuredClone(slot),
    supportedOperations: structuredClone(supportedOperations),
    assetIds: [],
  }
}

function payloadForBlock(
  block: WorkspaceBlock,
  template: PromptWorkspaceTemplate,
  controlValues: WorkspaceManifest['controlValues'],
): PanelPayload | undefined {
  switch (block.type) {
    case 'prompt':
      return {
        kind: 'prompt',
        promptTitle: template.prompt.title ?? template.title,
        body: template.prompt.body,
        negativePrompt: template.prompt.negativePrompt ?? '',
        ...(block['x-promptPart'] === 'body' || block['x-promptPart'] === 'negative'
          ? { displayPart: block['x-promptPart'] }
          : {}),
      }
    case 'controls':
      {
        const requestedIds = Array.isArray(block['x-controlIds'])
          ? block['x-controlIds'].filter((id): id is string => typeof id === 'string')
          : []
        const requested = new Set(requestedIds)
      return {
        kind: 'controls',
        controls: structuredClone(
          requested.size > 0
            ? (template.controls ?? []).filter((control) => requested.has(control.id))
            : (template.controls ?? []),
        ),
        values: structuredClone(controlValues),
      }
      }
    case 'references':
      return {
        kind: 'references',
        slots: structuredClone(template.references ?? []),
        items: [],
      }
    case 'output':
      return outputPayload(template, block.sourceId, 'output')
    case 'variations':
      return outputPayload(template, block.sourceId, 'variations')
    case 'workflow': {
      if (!template.workflow) return undefined
      const workflow = template.workflow
      return {
        kind: 'workflow',
        workflow: structuredClone(workflow),
        statuses: Object.fromEntries(
          workflow.stages.map((stage) => [
            stage.id,
            stage.id === (workflow.entryStageId ?? workflow.stages[0]?.id)
              ? 'active'
              : 'not-started',
          ]),
        ),
      }
    }
    case 'json':
      return { kind: 'json', value: block.content ?? {} }
    case 'notes':
    case 'freeform':
    case 'custom':
      return { kind: 'note', text: typeof block.content === 'string' ? block.content : '' }
    case 'comparison':
    case 'gallery':
      return outputPayload(template, block.sourceId, 'variations')
  }
}

function kindForBlock(block: WorkspaceBlock): PanelKind {
  if (block.type === 'notes' || block.type === 'freeform' || block.type === 'custom') return 'note'
  if (block.type === 'comparison' || block.type === 'gallery') return 'variations'
  return block.type
}

function defaultBlocks(template: PromptWorkspaceTemplate): WorkspaceBlock[] {
  const blocks: WorkspaceBlock[] = [
    { id: 'prompt-panel', type: 'prompt', title: 'Prompt', region: 'left', order: 10 },
  ]
  if ((template.references?.length ?? 0) > 0) {
    blocks.unshift({ id: 'references-panel', type: 'references', title: 'References', region: 'left', order: 5 })
  }
  if ((template.controls?.length ?? 0) > 0) {
    blocks.push({ id: 'controls-panel', type: 'controls', title: 'Controls', region: 'left', order: 20 })
  }
  if (template.workflow) {
    blocks.push({ id: 'workflow-panel', type: 'workflow', title: 'Workflow', region: 'left', order: 30 })
  }
  const primary = template.outputs.find((output) => output.role === 'primary') ?? template.outputs[0]
  blocks.push({
    id: 'primary-output',
    type: 'output',
    title: primary?.label ?? 'Output',
    sourceId: primary?.id,
    region: 'right',
    order: 10,
  })
  const variations = template.outputs.find((output) => output.role === 'variation')
  if (variations || template.generation.operations.includes('variation')) {
    blocks.push({
      id: 'variation-strip',
      type: 'variations',
      title: variations?.label ?? 'Variations',
      sourceId: variations?.id ?? primary?.id,
      region: 'right',
      order: 20,
    })
  }
  return blocks
}

function outputSlotForBlock(
  block: WorkspaceBlock,
  template: PromptWorkspaceTemplate,
): string | undefined {
  if (block.sourceId && template.outputs.some((slot) => slot.id === block.sourceId)) {
    return block.sourceId
  }
  const role =
    block.type === 'variations' || block.type === 'comparison' || block.type === 'gallery'
      ? 'variation'
      : 'primary'
  return template.outputs.find((slot) => slot.role === role)?.id ?? template.outputs[0]?.id
}

/**
 * Custom blocks are an arrangement hint, not permission to omit semantic
 * surfaces the runtime needs. Keep authored blocks and their order intact,
 * then append only declarations that are not represented by those blocks.
 */
export function ensureRequiredBlocks(
  template: PromptWorkspaceTemplate,
  authoredBlocks: WorkspaceBlock[],
): WorkspaceBlock[] {
  const blocks = [...authoredBlocks]
  const usedIds = new Set(blocks.map((block) => block.id))
  let nextOrder = Math.max(0, ...blocks.map((block) => block.order ?? 0)) + 1

  const append = (block: WorkspaceBlock): void => {
    const baseId = block.id
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)
    blocks.push({ ...block, id, order: nextOrder++ })
  }

  const promptBlocks = blocks.filter((block) => block.type === 'prompt')
  const hasVisiblePromptBody = promptBlocks.some((block) => block['x-promptPart'] !== 'negative')
  if (!hasVisiblePromptBody) {
    append({
      id: 'prompt-panel',
      type: 'prompt',
      title: 'Prompt',
      region: 'left',
      ...(promptBlocks.length > 0 ? { 'x-promptPart': 'body' } : {}),
    })
  }
  const controls = template.controls ?? []
  if (controls.length > 0) {
    const authoredControlBlocks = blocks.filter((block) => block.type === 'controls')
    const hasCompleteControlBlock = authoredControlBlocks.some((block) => {
      const requested = block['x-controlIds']
      return !Array.isArray(requested) || requested.length === 0
    })
    const representedControlIds = new Set(
      authoredControlBlocks.flatMap((block) => (
        Array.isArray(block['x-controlIds'])
          ? block['x-controlIds'].filter((id): id is string => typeof id === 'string')
          : []
      )),
    )
    const missingControlIds = hasCompleteControlBlock
      ? []
      : controls.map((control) => control.id).filter((id) => !representedControlIds.has(id))
    if (authoredControlBlocks.length === 0 || missingControlIds.length > 0) {
      append({
        id: 'controls-panel',
        type: 'controls',
        title: authoredControlBlocks.length === 0 ? 'Controls' : 'Additional controls',
        region: 'left',
        ...(authoredControlBlocks.length > 0 ? { 'x-controlIds': missingControlIds } : {}),
      })
    }
  }
  if (
    (template.references?.length ?? 0) > 0 &&
    !blocks.some((block) => block.type === 'references')
  ) {
    append({ id: 'references-panel', type: 'references', title: 'References', region: 'left' })
  }
  if (template.workflow && !blocks.some((block) => block.type === 'workflow')) {
    append({ id: 'workflow-panel', type: 'workflow', title: 'Workflow', region: 'left' })
  }

  const representedOutputIds = new Set(
    blocks
      .filter((block) =>
        block.type === 'output' ||
        block.type === 'variations' ||
        block.type === 'comparison' ||
        block.type === 'gallery',
      )
      .map((block) => outputSlotForBlock(block, template))
      .filter((slotId): slotId is string => Boolean(slotId)),
  )
  for (const slot of template.outputs) {
    if (representedOutputIds.has(slot.id)) continue
    append({
      id: `${slot.id}-output`,
      type: slot.role === 'variation' ? 'variations' : 'output',
      title: slot.label,
      sourceId: slot.id,
      region: 'right',
    })
    representedOutputIds.add(slot.id)
  }

  return blocks
}

function explicitGeometry(block: WorkspaceBlock): Partial<{ x: number; y: number; w: number; h: number }> {
  const value = block['x-geometry']
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const geometry = value as Record<string, unknown>
  return Object.fromEntries(
    ['x', 'y', 'w', 'h']
      .filter((key) => typeof geometry[key] === 'number' && Number.isFinite(geometry[key]))
      .map((key) => [key, geometry[key]]),
  )
}

function dimensions(
  kind: PanelKind,
  family: string | undefined,
  block: WorkspaceBlock,
): { w: number; h: number } {
  const explicit = explicitGeometry(block)
  if ((explicit.w ?? 0) > 0 && (explicit.h ?? 0) > 0) {
    return { w: explicit.w!, h: explicit.h! }
  }
  switch (kind) {
    case 'prompt':
      return { w: 430, h: family === 'lightweight' ? 300 : 520 }
    case 'controls':
      return { w: 430, h: 360 }
    case 'references':
      return { w: 430, h: 290 }
    case 'output':
      return { w: 420, h: 560 }
    case 'variations':
      return { w: 620, h: 210 }
    case 'workflow':
      return { w: 470, h: 330 }
    case 'json':
      return { w: 430, h: 430 }
    case 'note':
      return { w: 220, h: 150 }
  }
}

function blockPosition(
  block: WorkspaceBlock,
  kind: PanelKind,
  cursors: { left: number; right: number; center: number },
  family: string | undefined,
): { x: number; y: number; w: number; h: number; region: 'left' | 'right' | 'center' } {
  const size = dimensions(kind, family, block)
  const explicit = explicitGeometry(block)
  const requested = block.region ?? (kind === 'output' || kind === 'variations' ? 'right' : 'left')
  const region: 'left' | 'right' | 'center' =
    requested === 'right' || requested === 'center' ? requested : 'left'
  const x = explicit.x ??
    (region === 'left' ? LEFT_X : region === 'center' ? 560 : family === 'multi-stage' ? 1060 : 560)
  return { x, y: explicit.y ?? cursors[region], ...size, region }
}

export function compileWorkspacePanels(
  manifest: WorkspaceManifest,
  origin = { x: 0, y: 0 },
): PanelDescriptor[] {
  const template = manifest.templateSnapshot
  const family = template.compatibility?.templateFamily
  const blocks = [
    ...(template.blocks
      ? ensureRequiredBlocks(template, template.blocks)
      : defaultBlocks(template)),
  ].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  )

  const cursors = { left: TOP_Y, right: TOP_Y, center: TOP_Y }
  const descriptors: PanelDescriptor[] = []

  for (const block of blocks) {
    const payload = payloadForBlock(block, template, manifest.controlValues)
    if (!payload) continue
    const kind = kindForBlock(block)
    const position = blockPosition(block, kind, cursors, family)
    cursors[position.region] = Math.max(
      cursors[position.region],
      position.y + position.h + GAP,
    )
    descriptors.push({
      semanticId: block.id,
      title: block.title ?? template.title,
      kind,
      x: origin.x + position.x,
      y: origin.y + position.y,
      w: position.w,
      h: position.h,
      payload,
      locked: block.lockedByDefault,
    })
  }

  for (const [index, annotation] of (template.annotations ?? []).entries()) {
    const payload: NotePanelPayload = {
      kind: 'note',
      text: annotation.text,
      tone:
        annotation.kind === 'warning'
          ? 'pink'
          : annotation.kind === 'tip'
            ? 'green'
            : annotation.kind === 'source'
              ? 'blue'
              : 'yellow',
    }
    descriptors.push({
      semanticId: `annotation-${annotation.id}`,
      title: annotation.kind,
      kind: 'note',
      x: origin.x + 1020 + (index % 2) * 250,
      y: origin.y + TOP_Y + Math.floor(index / 2) * 180,
      w: 220,
      h: 140,
      payload,
    })
  }

  return descriptors
}

/**
 * Compile optional directed workflow relationships separately from panels.
 * Connections are presentation-only and never alter generation semantics.
 */
export function compileWorkspaceConnections(
  manifest: WorkspaceManifest,
  compatibleTemplate?: PromptWorkspaceTemplate,
): WorkspaceConnectionDescriptor[] {
  const snapshotHasConnections = manifest.templateSnapshot.blocks?.some(
    (block) => block['x-connectTo'] !== undefined,
  ) ?? false
  const template = !snapshotHasConnections &&
      compatibleTemplate?.id === manifest.templateSnapshot.id &&
      compatibleTemplate.version === manifest.templateSnapshot.version
    ? compatibleTemplate
    : manifest.templateSnapshot
  const blocks = template.blocks
    ? ensureRequiredBlocks(template, template.blocks)
    : defaultBlocks(template)
  const knownIds = new Set(blocks.map((block) => block.id))
  const seen = new Set<string>()
  const connections: WorkspaceConnectionDescriptor[] = []

  for (const block of blocks) {
    const rawTargets = block['x-connectTo']
    const targets = typeof rawTargets === 'string'
      ? [rawTargets]
      : Array.isArray(rawTargets)
        ? rawTargets.filter((target): target is string => typeof target === 'string')
        : []
    for (const targetSemanticId of targets) {
      if (targetSemanticId === block.id || !knownIds.has(targetSemanticId)) continue
      const key = `${block.id}->${targetSemanticId}`
      if (seen.has(key)) continue
      seen.add(key)
      connections.push({ sourceSemanticId: block.id, targetSemanticId })
    }
  }

  return connections
}
