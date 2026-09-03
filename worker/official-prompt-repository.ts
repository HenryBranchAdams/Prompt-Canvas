export type D1Value = null | number | string | ArrayBuffer | ArrayBufferView

export interface D1Result<Row = Record<string, unknown>> {
  results?: Row[]
  success: boolean
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement
  all<Row = Record<string, unknown>>(): Promise<D1Result<Row>>
  first<Row = Record<string, unknown>>(): Promise<Row | null>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

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

type PromptRow = {
  id: string
  current_version: number
  content_hash: string
  title: string
  short_description: string
  user_promise: string
  collection: string
  category: string
  template_family: string
  default_operation: string
  input_mode: string
  output_kind: string
  complexity: string
  required_input_summary: string
  preservation_summary: string
  badges: string
  aliases: string
  thumbnail_path: string
  thumbnail_alt: string
  featured_rank: number | null
  capabilities: string | null
  intents: string | null
  input_modes: string | null
  subject_kinds: string | null
  output_kinds: string | null
  preservation_needs: string | null
}

type VersionRow = {
  prompt_id: string
  version: number
  template_json: string
  template_schema: string
  content_hash: string
  source_json: string
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function summaryFromRow(row: PromptRow, matchReasons?: string[]): OfficialPromptSummary {
  return {
    source: 'official',
    id: row.id,
    version: row.current_version,
    hash: row.content_hash,
    title: row.title,
    description: row.short_description,
    userPromise: row.user_promise,
    collection: row.collection,
    category: row.category,
    family: row.template_family,
    defaultOperation: row.default_operation,
    intents: parseStringArray(row.intents),
    inputModes: parseStringArray(row.input_modes),
    subjectKinds: parseStringArray(row.subject_kinds),
    outputKinds: parseStringArray(row.output_kinds),
    preservationNeeds: parseStringArray(row.preservation_needs),
    inputMode: row.input_mode,
    outputKind: row.output_kind,
    complexity: row.complexity,
    requiredInputs: parseStringArray(row.required_input_summary),
    preserves: parseStringArray(row.preservation_summary),
    badges: parseStringArray(row.badges),
    aliases: parseStringArray(row.aliases),
    capabilities: parseStringArray(row.capabilities),
    thumbnail: { src: row.thumbnail_path, alt: row.thumbnail_alt },
    featuredRank: row.featured_rank,
    ...(matchReasons?.length ? { matchReasons } : {}),
  }
}

function boundedUnique(values: string[] | undefined, maxItems = 20): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, maxItems)
}

export function toFtsQuery(query: string): string | null {
  const tokens = query
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 16)
  return tokens?.length ? tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ') : null
}

const SUMMARY_SELECT = `
  SELECT p.*, v.content_hash,
    (SELECT json_group_array(facet_value) FROM official_prompt_facets
      WHERE prompt_id = p.id AND facet_type = 'capability') AS capabilities,
    (SELECT json_group_array(facet_value) FROM official_prompt_facets
      WHERE prompt_id = p.id AND facet_type = 'intent') AS intents,
    (SELECT json_group_array(facet_value) FROM official_prompt_facets
      WHERE prompt_id = p.id AND facet_type = 'input-mode') AS input_modes,
    (SELECT json_group_array(facet_value) FROM official_prompt_facets
      WHERE prompt_id = p.id AND facet_type = 'subject-kind') AS subject_kinds,
    (SELECT json_group_array(facet_value) FROM official_prompt_facets
      WHERE prompt_id = p.id AND facet_type = 'output-kind') AS output_kinds,
    (SELECT json_group_array(facet_value) FROM official_prompt_facets
      WHERE prompt_id = p.id AND facet_type = 'preservation-need') AS preservation_needs
  FROM official_prompts p
  JOIN official_prompt_versions v
    ON v.prompt_id = p.id AND v.version = p.current_version`

export class OfficialPromptRepository {
  constructor(private readonly db: D1Database) {}

  async catalog(limit = 100, offset = 0): Promise<OfficialPromptSummary[]> {
    const result = await this.db.prepare(`${SUMMARY_SELECT}
      WHERE p.active = 1
      ORDER BY p.featured_rank IS NULL, p.featured_rank, p.title
      LIMIT ?1 OFFSET ?2`).bind(Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)).all<PromptRow>()
    return (result.results ?? []).map((row) => summaryFromRow(row))
  }

  async catalogMeta(): Promise<{ catalogVersion: string; buildHash: string; publishedAt: string } | null> {
    const row = await this.db.prepare(`SELECT catalog_version, build_hash, published_at
      FROM official_prompt_catalog_meta WHERE singleton = 1`).first<{
        catalog_version: string
        build_hash: string
        published_at: string
      }>()
    return row ? { catalogVersion: row.catalog_version, buildHash: row.build_hash, publishedAt: row.published_at } : null
  }

  async search(input: OfficialPromptSearchInput): Promise<OfficialPromptSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 20)
    const ftsQuery = toFtsQuery(input.query)
    const facetGroups: Array<[string, string[]]> = [
      ['intent', boundedUnique(input.intents)],
      ['input-mode', boundedUnique(input.inputModes)],
      ['subject-kind', boundedUnique(input.subjectKinds)],
      ['output-kind', boundedUnique(input.outputKinds)],
      ['preservation-need', boundedUnique(input.preservationNeeds)],
      ['collection', boundedUnique(input.collections)],
      ['capability', boundedUnique(input.capabilities)],
    ].filter((group): group is [string, string[]] => group[1].length > 0)

    const binds: D1Value[] = []
    const clauses = ['p.active = 1']
    let rank = '0'
    let join = ''
    if (ftsQuery) {
      binds.push(ftsQuery)
      join = 'JOIN official_prompt_fts f ON f.prompt_id = p.id'
      clauses.push(`official_prompt_fts MATCH ?${binds.length}`)
      rank = `bm25(official_prompt_fts, 0, 8, 3, 6, 1, 1)`
    }
    for (const [type, values] of facetGroups) {
      binds.push(type)
      const typeIndex = binds.length
      const valueSlots = values.map((value) => {
        binds.push(value)
        return `?${binds.length}`
      })
      clauses.push(`EXISTS (SELECT 1 FROM official_prompt_facets sf
        WHERE sf.prompt_id = p.id AND sf.facet_type = ?${typeIndex}
          AND sf.facet_value IN (${valueSlots.join(', ')}))`)
    }
    binds.push(limit)
    const result = await this.db.prepare(`${SUMMARY_SELECT}
      ${join}
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${rank}, p.featured_rank IS NULL, p.featured_rank, p.title
      LIMIT ?${binds.length}`).bind(...binds).all<PromptRow>()
    return (result.results ?? []).map((row) => summaryFromRow(row, this.matchReasons(row, input)))
  }

  async getVersion(id: string, version?: number): Promise<{
    template: unknown
    version: number
    hash: string
    templateSchema: string
    provenance: unknown
  } | null> {
    const sql = version === undefined
      ? `SELECT v.* FROM official_prompt_versions v JOIN official_prompts p ON p.id = v.prompt_id
          WHERE p.id = ?1 AND p.active = 1 AND v.version = p.current_version`
      : `SELECT v.* FROM official_prompt_versions v JOIN official_prompts p ON p.id = v.prompt_id
          WHERE p.id = ?1 AND p.active = 1 AND v.version = ?2`
    const statement = this.db.prepare(sql).bind(...(version === undefined ? [id] : [id, version]))
    const row = await statement.first<VersionRow>()
    if (!row) return null
    return {
      template: JSON.parse(row.template_json),
      version: row.version,
      hash: row.content_hash,
      templateSchema: row.template_schema,
      provenance: JSON.parse(row.source_json),
    }
  }

  private matchReasons(row: PromptRow, input: OfficialPromptSearchInput): string[] {
    const reasons: string[] = []
    const query = input.query.trim().toLowerCase()
    if (query && row.title.toLowerCase().includes(query)) reasons.push('title match')
    if (query && row.user_promise.toLowerCase().includes(query)) reasons.push('user-promise match')
    if (boundedUnique(input.inputModes).includes(row.input_mode.toLowerCase())) reasons.push(`${row.input_mode} input`)
    if (boundedUnique(input.outputKinds).includes(row.output_kind.toLowerCase())) reasons.push(`${row.output_kind} output`)
    if (boundedUnique(input.collections).includes(row.collection.toLowerCase())) reasons.push(`${row.collection} collection`)
    return reasons.slice(0, 6)
  }
}
