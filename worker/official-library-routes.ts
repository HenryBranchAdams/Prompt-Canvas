import { OfficialPromptRepository, type D1Database } from './official-prompt-repository.js'
import { OfficialLibraryInputError, parseOfficialPromptSearch, validOfficialPromptId } from './request-validation.js'

const MAX_SEARCH_BODY_BYTES = 16_384

class RequestTooLargeError extends Error {}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SEARCH_BODY_BYTES) {
        await reader.cancel('Search request exceeded the byte limit.')
        throw new RequestTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function boundedQueryInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new OfficialLibraryInputError(`Query pagination must use integers from ${minimum} to ${maximum}.`)
  }
  return parsed
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, { ...init, headers: { ...JSON_HEADERS, ...(init.headers ?? {}) } })
}

function error(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function handleOfficialLibraryRequest(request: Request, db: D1Database): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/official-library/')) return null
  const repository = new OfficialPromptRepository(db)

  try {
    if (request.method === 'GET' && url.pathname === '/api/official-library/catalog') {
      const limit = boundedQueryInteger(url.searchParams.get('limit'), 100, 1, 100)
      const offset = boundedQueryInteger(url.searchParams.get('offset'), 0, 0, 10_000)
      const [catalog, meta] = await Promise.all([repository.catalog(limit, offset), repository.catalogMeta()])
      if (!meta) return error(503, 'CATALOG_NOT_READY', 'The official recipe catalog is not available yet.')
      const etag = `"${meta.buildHash}"`
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } })
      return json({ ok: true, catalog, meta, nextOffset: catalog.length === limit ? offset + limit : null }, {
        headers: { 'Cache-Control': 'public, max-age=300', ETag: etag },
      })
    }

    if (request.method === 'POST' && url.pathname === '/api/official-library/search') {
      const contentLengthHeader = request.headers.get('Content-Length')
      const contentLength = contentLengthHeader === null ? 0 : Number(contentLengthHeader)
      if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_SEARCH_BODY_BYTES) {
        return error(413, 'REQUEST_TOO_LARGE', 'The search request is too large.')
      }
      const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        return error(415, 'UNSUPPORTED_MEDIA_TYPE', 'Official recipe search requires application/json.')
      }
      const body = await readBoundedBody(request)
      let candidate: unknown
      try {
        candidate = JSON.parse(body)
      } catch {
        return error(400, 'INVALID_JSON', 'The search request body must contain valid JSON.')
      }
      const input = parseOfficialPromptSearch(candidate)
      const candidates = await repository.search(input)
      return json({ ok: true, candidates }, { headers: { 'Cache-Control': 'private, no-store' } })
    }

    const versionMatch = url.pathname.match(/^\/api\/official-library\/prompts\/([^/]+)\/versions\/(\d+)$/)
    const currentMatch = url.pathname.match(/^\/api\/official-library\/prompts\/([^/]+)$/)
    if (request.method === 'GET' && (versionMatch || currentMatch)) {
      const id = decodeURIComponent((versionMatch ?? currentMatch)![1])
      if (!validOfficialPromptId(id)) return error(400, 'INVALID_PROMPT_ID', 'The official recipe ID is invalid.')
      const version = versionMatch ? Number(versionMatch[2]) : undefined
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
        return error(400, 'INVALID_PROMPT_VERSION', 'The official recipe version is invalid.')
      }
      const record = await repository.getVersion(id, version)
      if (!record) return error(404, 'OFFICIAL_PROMPT_NOT_FOUND', 'That official recipe version was not found.')
      const etag = `"${record.hash}"`
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } })
      return json({ ok: true, source: 'official', id, ...record }, {
        headers: {
          'Cache-Control': versionMatch ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
          ETag: etag,
        },
      })
    }

    return error(404, 'OFFICIAL_LIBRARY_ROUTE_NOT_FOUND', 'No read-only official-library route matches this request.')
  } catch (cause) {
    if (cause instanceof RequestTooLargeError) {
      return error(413, 'REQUEST_TOO_LARGE', 'The search request is too large.')
    }
    if (cause instanceof OfficialLibraryInputError) {
      return error(400, 'INVALID_REQUEST', cause.message)
    }
    return error(500, 'OFFICIAL_LIBRARY_REQUEST_FAILED', 'The official recipe request failed.')
  }
}
