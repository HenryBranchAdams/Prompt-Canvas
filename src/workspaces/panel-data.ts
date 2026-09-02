import type { PanelPayload } from './types'

const MAX_PANEL_PAYLOAD_CHARACTERS = 500_000

export function serializePanelPayload(payload: PanelPayload): string {
  const serialized = JSON.stringify(payload)
  if (serialized.length > MAX_PANEL_PAYLOAD_CHARACTERS) {
    throw new Error('Panel payload exceeds the bounded local limit.')
  }
  return serialized
}

export function parsePanelPayload(serialized: string): PanelPayload {
  if (serialized.length > MAX_PANEL_PAYLOAD_CHARACTERS) {
    throw new Error('Panel payload exceeds the bounded local limit.')
  }
  const value = JSON.parse(serialized) as unknown
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    throw new Error('Invalid prompt canvas panel payload.')
  }
  return value as PanelPayload
}
