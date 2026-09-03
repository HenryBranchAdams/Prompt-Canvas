import { OfficialPromptRepository, type D1Database } from './official-prompt-repository.js'
import { parseOfficialPromptSearch, validOfficialPromptId } from './request-validation.js'

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
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 100)
      const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
      const [catalog, meta] = await Promise.all([repository.catalog(limit, offset), repository.catalogMeta()])
      if (!meta) return error(503, 'CATALOG_NOT_READY', 'The official recipe catalog is not available yet.')
      const etag = `"${meta.buildHash}"`
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } })
      return json({ ok: true, catalog, meta, nextOffset: catalog.length === limit ? offset + limit : null }, {
        headers: { 'Cache-Control': 'public, max-age=300', ETag: etag },
      })
    }

    if (request.method === 'POST' && url.pathname === '/api/official-library/search') {
      const contentLength = Number(request.headers.get('Content-Length') ?? 0)
      if (contentLength > 16_384) return error(413, 'REQUEST_TOO_LARGE', 'The search request is too large.')
      const body = await request.text()
      if (new TextEncoder().encode(body).byteLength > 16_384) {
        return error(413, 'REQUEST_TOO_LARGE', 'The search request is too large.')
      }
      const input = parseOfficialPromptSearch(JSON.parse(body))
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
    const message = cause instanceof Error ? cause.message : 'The official recipe request failed.'
    return error(message.includes('must be') || message.includes('unsupported') ? 400 : 500, 'OFFICIAL_LIBRARY_REQUEST_FAILED', message)
  }
}
