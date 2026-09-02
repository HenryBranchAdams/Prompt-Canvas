import type { JsonValue, OutputManagementOperation, WorkspaceUpdateOperation } from '../workspaces/types'

export const PANEL_ACTION_EVENT = 'prompt-canvas:panel-action'

export type PanelActionDetail =
  | {
      workspaceId: string
      type: 'workspace-update'
      operation: WorkspaceUpdateOperation
    }
  | {
      workspaceId: string
      type: 'manage-output'
      operation: OutputManagementOperation
    }
  | {
      workspaceId: string
      type: 'prepare-generation'
      outputSlotId?: string
      operation?: 'generate' | 'edit' | 'variation' | 'upscale'
    }
  | {
      workspaceId: string
      type: 'set-control-values'
      controlId: string
      value: JsonValue
    }

export function dispatchPanelAction(detail: PanelActionDetail): void {
  window.dispatchEvent(new CustomEvent<PanelActionDetail>(PANEL_ACTION_EVENT, { detail }))
}
