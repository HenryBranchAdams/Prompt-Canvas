import type { OfficialPromptSearchInput } from './official-prompt-repository.js'

const FACET_KEYS = [
  'intents', 'inputModes', 'subjectKinds', 'outputKinds', 'preservationNeeds', 'collections', 'categories', 'families',
  'capabilities',
] as const

export class OfficialLibraryInputError extends Error {}

function stringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== 'string' || item.length > 100)) {
    throw new OfficialLibraryInputError(`${name} must be an array of at most 20 short strings.`)
  }
  return value
}

export function parseOfficialPromptSearch(value: unknown): OfficialPromptSearchInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OfficialLibraryInputError('The request body must be an object.')
  const record = value as Record<string, unknown>
  const allowed = new Set<string>(['query', 'limit', ...FACET_KEYS])
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new OfficialLibraryInputError('The request body contains unsupported fields.')
  if (typeof record.query !== 'string' || record.query.length > 300) throw new OfficialLibraryInputError('query must be a string of at most 300 characters.')
  if (record.limit !== undefined && (!Number.isInteger(record.limit) || (record.limit as number) < 1 || (record.limit as number) > 20)) {
    throw new OfficialLibraryInputError('limit must be an integer from 1 to 20.')
  }
  return {
    query: record.query,
    ...(record.limit !== undefined ? { limit: record.limit as number } : {}),
    ...Object.fromEntries(FACET_KEYS.flatMap((key) => {
      const parsed = stringList(record[key], key)
      return parsed ? [[key, parsed]] : []
    })),
  }
}

export function validOfficialPromptId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(value)
}
