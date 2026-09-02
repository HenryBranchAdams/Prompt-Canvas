import type { GenerationContext, OutputPanelPayload } from './types.js'

/** Workspace membership, not whichever page happens to be open, scopes input. */
export function resolveOutputSelection(input: {
  workspaceId: string
  allowedAssetIds: string[]
  selectedPanels: Array<{ workspaceId: string; semanticId: string; assetIds: string[] }>
  requestedAssetIds?: string[]
}): GenerationContext['selection'] {
  const allowed = new Set(input.allowedAssetIds)
  const panels = input.selectedPanels.filter((panel) => panel.workspaceId === input.workspaceId)
  if (input.requestedAssetIds?.some((id) => !allowed.has(id))) {
    throw new Error('Selected output contains an asset outside the requested workspace.')
  }
  const assetIds = [...new Set(input.requestedAssetIds ?? panels.flatMap((panel) => panel.assetIds).filter((id) => allowed.has(id)))]
  const semanticIds = [...new Set(panels.map((panel) => panel.semanticId))]
  return assetIds.length || semanticIds.length ? { assetIds, semanticIds } : null
}

/** Archive every active occurrence while keeping local assets for undo/lineage. */
export function archiveOutputAsset(payload: OutputPanelPayload, assetId: string): OutputPanelPayload {
  const wasActive = payload.assetIds.includes(assetId)
  const next: OutputPanelPayload = {
    ...payload,
    assetIds: payload.assetIds.filter((id) => id !== assetId),
    ...(wasActive ? { archivedAssetIds: [...new Set([...(payload.archivedAssetIds ?? []), assetId])] } : {}),
    ...(payload.compareAssetIds ? { compareAssetIds: payload.compareAssetIds.filter((id) => id !== assetId) } : {}),
  }
  if (next.promotedAssetId === assetId) delete next.promotedAssetId
  return next
}
