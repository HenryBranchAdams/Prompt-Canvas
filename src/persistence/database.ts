import type { ActivityEntry, JsonValue, PromptWorkspaceTemplate } from '../workspaces/types'
import {
  DEFAULT_ACTIVITY_RETENTION,
  normalizeActivityRetention,
  retainNewestActivity,
} from '../activity/retention'

const DB_NAME = 'prompt-canvas-local'
const DB_VERSION = 1
const TEMPLATES = 'templates'
const ACTIVITY = 'activity'
const SETTINGS = 'settings'

type TemplateRecord = {
  key: string
  id: string
  version: number
  template: PromptWorkspaceTemplate
  savedAt: string
}

type SettingRecord = { key: string; value: JsonValue }

const memory = {
  templates: new Map<string, TemplateRecord>(),
  activity: new Map<string, ActivityEntry>(),
  settings: new Map<string, SettingRecord>(),
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
  })
}

export class PromptCanvasDatabase {
  private databasePromise: Promise<IDBDatabase | null> | null = null

  private open(): Promise<IDBDatabase | null> {
    if (this.databasePromise) return this.databasePromise
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)

    const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(TEMPLATES)) {
          const store = db.createObjectStore(TEMPLATES, { keyPath: 'key' })
          store.createIndex('id', 'id', { unique: false })
          store.createIndex('savedAt', 'savedAt', { unique: false })
        }
        if (!db.objectStoreNames.contains(ACTIVITY)) {
          const store = db.createObjectStore(ACTIVITY, { keyPath: 'id' })
          store.createIndex('at', 'at', { unique: false })
        }
        if (!db.objectStoreNames.contains(SETTINGS)) {
          db.createObjectStore(SETTINGS, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Unable to open local Prompt Canvas database.'))
      request.onblocked = () => reject(new Error('Prompt Canvas database upgrade is blocked by another tab.'))
    }).catch((error): IDBDatabase | null => {
      console.warn('Prompt Canvas is using memory-only persistence.', error)
      return null
    })
    this.databasePromise = databasePromise
    return databasePromise
  }

  async listTemplates(): Promise<PromptWorkspaceTemplate[]> {
    const db = await this.open()
    if (!db) return [...memory.templates.values()].map((record) => structuredClone(record.template))
    const transaction = db.transaction(TEMPLATES, 'readonly')
    const records = await requestResult(transaction.objectStore(TEMPLATES).getAll() as IDBRequest<TemplateRecord[]>)
    await transactionDone(transaction)
    return records
      .sort((a, b) => a.id.localeCompare(b.id) || b.version - a.version)
      .map((record) => record.template)
  }

  async saveTemplate(template: PromptWorkspaceTemplate): Promise<void> {
    const record: TemplateRecord = {
      key: `${template.id}@${template.version}`,
      id: template.id,
      version: template.version,
      template: structuredClone(template),
      savedAt: new Date().toISOString(),
    }
    const db = await this.open()
    if (!db) {
      memory.templates.set(record.key, record)
      return
    }
    const transaction = db.transaction(TEMPLATES, 'readwrite')
    transaction.objectStore(TEMPLATES).put(record)
    await transactionDone(transaction)
  }

  async appendActivity(
    entry: ActivityEntry,
    retention = DEFAULT_ACTIVITY_RETENTION,
  ): Promise<void> {
    const boundedRetention = normalizeActivityRetention(retention)
    const db = await this.open()
    if (!db) {
      memory.activity.set(entry.id, structuredClone(entry))
      const retainedIds = new Set(
        retainNewestActivity(memory.activity.values(), boundedRetention).map((item) => item.id),
      )
      for (const id of memory.activity.keys()) {
        if (!retainedIds.has(id)) memory.activity.delete(id)
      }
      return
    }
    const transaction = db.transaction(ACTIVITY, 'readwrite')
    const store = transaction.objectStore(ACTIVITY)
    store.put(entry)
    const records = await requestResult(store.getAll() as IDBRequest<ActivityEntry[]>)
    const retainedIds = new Set(
      retainNewestActivity(records, boundedRetention).map((item) => item.id),
    )
    for (const record of records) {
      if (!retainedIds.has(record.id)) store.delete(record.id)
    }
    await transactionDone(transaction)
  }

  async listActivity(limit = DEFAULT_ACTIVITY_RETENTION): Promise<ActivityEntry[]> {
    const boundedLimit = normalizeActivityRetention(limit)
    const db = await this.open()
    if (!db) {
      const retained = retainNewestActivity(memory.activity.values(), boundedLimit)
      const retainedIds = new Set(retained.map((entry) => entry.id))
      for (const id of memory.activity.keys()) {
        if (!retainedIds.has(id)) memory.activity.delete(id)
      }
      return retained.map((entry) => structuredClone(entry))
    }
    const transaction = db.transaction(ACTIVITY, 'readwrite')
    const store = transaction.objectStore(ACTIVITY)
    const records = await requestResult(store.getAll() as IDBRequest<ActivityEntry[]>)
    const retained = retainNewestActivity(records, boundedLimit)
    const retainedIds = new Set(retained.map((entry) => entry.id))
    for (const record of records) {
      if (!retainedIds.has(record.id)) store.delete(record.id)
    }
    await transactionDone(transaction)
    return retained
  }

  async setSetting(key: string, value: JsonValue): Promise<void> {
    const record: SettingRecord = { key, value: structuredClone(value) }
    const db = await this.open()
    if (!db) {
      memory.settings.set(key, record)
      return
    }
    const transaction = db.transaction(SETTINGS, 'readwrite')
    transaction.objectStore(SETTINGS).put(record)
    await transactionDone(transaction)
  }

  async getSetting<T extends JsonValue>(key: string): Promise<T | undefined> {
    const db = await this.open()
    if (!db) return memory.settings.get(key)?.value as T | undefined
    const transaction = db.transaction(SETTINGS, 'readonly')
    const record = await requestResult(
      transaction.objectStore(SETTINGS).get(key) as IDBRequest<SettingRecord | undefined>,
    )
    await transactionDone(transaction)
    return record?.value as T | undefined
  }
}
