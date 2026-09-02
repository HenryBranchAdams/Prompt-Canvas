import { createActivityId } from '../workspaces/ids'
import type { ActivityEntry, ActivitySource, JsonValue } from '../workspaces/types'
import type { PromptCanvasDatabase } from '../persistence/database'
import {
  DEFAULT_ACTIVITY_RETENTION,
  normalizeActivityRetention,
  retainNewestActivity,
} from './retention'

type ActivityListener = (entries: ActivityEntry[]) => void

export class ActivityStore {
  private entries: ActivityEntry[] = []
  private listeners = new Set<ActivityListener>()

  private readonly retention: number

  constructor(
    private readonly database: PromptCanvasDatabase,
    retention = DEFAULT_ACTIVITY_RETENTION,
  ) {
    this.retention = normalizeActivityRetention(retention)
  }

  async initialize(): Promise<void> {
    this.entries = await this.database.listActivity(this.retention)
    this.emit()
  }

  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener)
    listener(this.getEntries())
    return () => this.listeners.delete(listener)
  }

  getEntries(workspaceId?: string): ActivityEntry[] {
    const source = workspaceId
      ? this.entries.filter((entry) => entry.workspaceId === workspaceId)
      : this.entries
    return source.map((entry) => structuredClone(entry))
  }

  add(input: {
    source: ActivitySource
    kind: string
    summary: string
    workspaceId?: string
    detail?: JsonValue
    status?: ActivityEntry['status']
  }): ActivityEntry {
    const entry: ActivityEntry = {
      id: createActivityId(),
      at: new Date().toISOString(),
      source: input.source,
      kind: input.kind,
      summary: input.summary,
      status: input.status ?? 'info',
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    }
    this.entries = retainNewestActivity([entry, ...this.entries], this.retention)
    this.emit()
    void this.database.appendActivity(entry, this.retention)
    return entry
  }

  private emit(): void {
    const snapshot = this.getEntries()
    for (const listener of this.listeners) listener(snapshot)
  }
}
