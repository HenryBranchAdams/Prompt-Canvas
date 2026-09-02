import { createWorkspaceId } from './ids.js'
import { initialControlValues } from './prompt-resolver.js'
import type { JsonValue, PromptWorkspaceTemplate, WorkspaceManifest } from './types.js'

export function createWorkspaceManifest(
  template: PromptWorkspaceTemplate,
  values: Record<string, JsonValue> = {},
  now = new Date().toISOString(),
): WorkspaceManifest {
  const controlValues = { ...initialControlValues(template), ...structuredClone(values) }
  return {
    schema: 'prompt-canvas.workspace@1',
    workspaceId: createWorkspaceId(),
    templateId: template.id,
    templateVersion: template.version,
    title: template.title,
    activePromptId: 'prompt',
    documentRevision: 0,
    generationRevision: 0,
    createdAt: now,
    updatedAt: now,
    templateSnapshot: structuredClone(template),
    controlValues,
    generationState: 'empty',
  }
}
