import bundledCatalog from '../../generated/official-library/catalog.json'
import type { PromptCanvasDatabase } from '../persistence/database'
import { sha256Hex, stableStringify } from '../workspaces/hash'
import type { JsonValue, PromptWorkspaceTemplate } from '../workspaces/types'

export type OfficialPromptSummary = {
  source: 'official'
  id: string
  version: number
  hash: string
  title: string
  description: string
  userPromise: string
  collection: string
  category: string
  family: string
  defaultOperation: string
  intents: string[]
  inputModes: string[]
  subjectKinds: string[]
  outputKinds: string[]
  preservationNeeds: string[]
  inputMode: string
  outputKind: string
  complexity: string
  requiredInputs: string[]
  preserves: string[]
  badges: string[]
  aliases: string[]
  capabilities: string[]
  thumbnail: { src: string; alt: string }
  featuredRank: number | null
  matchReasons?: string[]
}

export type OfficialPromptSearchInput = {
  query: string
  intents?: string[]
  inputModes?: string[]
  subjectKinds?: string[]
  outputKinds?: string[]
  preservationNeeds?: string[]
  collections?: string[]
  capabilities?: string[]
  limit?: number
}

type CatalogResponse = {
  ok: true
  catalog: OfficialPromptSummary[]
  meta: { catalogVersion: string; buildHash: string; publishedAt: string }
}

type VersionResponse = {
  ok: true
  source: 'official'
  id: string
  version: number
  hash: string
  template: PromptWorkspaceTemplate
}

const CATALOG_CACHE_KEY = 'official-library:catalog@1'

function isSummary(value: unknown): value is OfficialPromptSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<OfficialPromptSummary>
  return item.source === 'official' && typeof item.id === 'string' && Number.isInteger(item.version) &&
    typeof item.hash === 'string' && typeof item.title === 'string' && typeof item.userPromise === 'string' &&
    Array.isArray(item.requiredInputs) && Array.isArray(item.aliases)
}

function localSearch(records: OfficialPromptSummary[], input: OfficialPromptSearchInput): OfficialPromptSummary[] {
  const terms = input.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const scored = records.map((record) => {
    const title = record.title.toLowerCase()
    const promise = record.userPromise.toLowerCase()
    const haystack = [record.title, record.description, record.userPromise, ...record.aliases].join(' ').toLowerCase()
    const score = terms.reduce((total, term) => total + (title.includes(term) ? 8 : 0) +
      (promise.includes(term) ? 5 : 0) + (haystack.includes(term) ? 1 : 0), 0)
    return { record, score }
  })
  return scored
    .filter(({ record, score }) => (!terms.length || score > 0) &&
      (!input.intents?.length || input.intents.some((value) => record.intents.includes(value))) &&
      (!input.inputModes?.length || input.inputModes.some((value) => record.inputModes.includes(value))) &&
      (!input.subjectKinds?.length || input.subjectKinds.some((value) => record.subjectKinds.includes(value))) &&
      (!input.outputKinds?.length || input.outputKinds.some((value) => record.outputKinds.includes(value))) &&
      (!input.preservationNeeds?.length || input.preservationNeeds.some((value) => record.preservationNeeds.includes(value))) &&
      (!input.collections?.length || input.collections.includes(record.collection)) &&
      (!input.capabilities?.length || input.capabilities.every((value) => record.capabilities.includes(value))))
    .sort((a, b) => b.score - a.score || (a.record.featuredRank ?? 999) - (b.record.featuredRank ?? 999))
    .slice(0, Math.min(Math.max(input.limit ?? 8, 1), 20))
    .map(({ record }) => structuredClone(record))
}

export class OfficialPromptCatalog {
  private summaries = new Map<string, OfficialPromptSummary>()

  constructor(private readonly database: PromptCanvasDatabase, private readonly fetcher: typeof fetch = fetch) {
    for (const summary of bundledCatalog.prompts) {
      if (isSummary(summary)) this.summaries.set(summary.id, structuredClone(summary))
    }
  }

  async initialize(): Promise<void> {
    const cached = await this.database.getSetting<JsonValue>(CATALOG_CACHE_KEY)
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      const catalog = (cached as { catalog?: unknown }).catalog
      if (Array.isArray(catalog)) {
        for (const summary of catalog) if (isSummary(summary)) this.summaries.set(summary.id, structuredClone(summary))
      }
    }
    try {
      const response = await this.fetcher('/api/official-library/catalog', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return
      const payload = await response.json() as CatalogResponse
      if (!payload.ok || !Array.isArray(payload.catalog) || payload.catalog.some((item) => !isSummary(item))) return
      this.summaries = new Map(payload.catalog.map((item) => [item.id, structuredClone(item)]))
      await this.database.setSetting(CATALOG_CACHE_KEY, payload as unknown as JsonValue)
    } catch {
      // Bundled and last-known-good cached summaries remain available.
    }
  }

  list(): OfficialPromptSummary[] {
    return [...this.summaries.values()].map((item) => structuredClone(item))
  }

  async search(input: OfficialPromptSearchInput): Promise<OfficialPromptSummary[]> {
    try {
      const response = await this.fetcher('/api/official-library/search', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        const payload = await response.json() as { ok: true; candidates: unknown[] }
        if (payload.ok && Array.isArray(payload.candidates) && payload.candidates.every(isSummary)) {
          return payload.candidates.map((item) => structuredClone(item))
        }
      }
    } catch {
      // Search the bounded official summary cache below.
    }
    return localSearch(this.list(), input)
  }

  async getPrompt(id: string, version?: number, expectedHash?: string): Promise<{
    template: PromptWorkspaceTemplate
    summary: OfficialPromptSummary
  } | undefined> {
    const summary = this.summaries.get(id)
    if (!summary) return undefined
    const resolvedVersion = version ?? summary.version
    const resolvedHash = expectedHash ?? (resolvedVersion === summary.version ? summary.hash : undefined)
    if (!resolvedHash) return undefined
    const cacheKey = `official-library:version:${id}@${resolvedVersion}:${resolvedHash}`
    const cached = await this.database.getSetting<JsonValue>(cacheKey)
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      return { template: structuredClone(cached as unknown as PromptWorkspaceTemplate), summary: structuredClone(summary) }
    }
    try {
      const response = await this.fetcher(`/api/official-library/prompts/${encodeURIComponent(id)}/versions/${resolvedVersion}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return undefined
      const payload = await response.json() as VersionResponse
      if (!payload.ok || payload.id !== id || payload.version !== resolvedVersion || payload.hash !== resolvedHash) return undefined
      const actualHash = `sha256:${await sha256Hex(stableStringify(payload.template))}`
      if (actualHash !== resolvedHash) throw new Error('Official recipe content did not match its expected hash.')
      await this.database.setSetting(cacheKey, payload.template as unknown as JsonValue)
      return { template: structuredClone(payload.template), summary: structuredClone(summary) }
    } catch {
      return undefined
    }
  }
}
