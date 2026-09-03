import { handleOfficialLibraryRequest } from './official-library-routes.js'
import type { D1Database } from './official-prompt-repository.js'

interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetsBinding
  DB?: D1Database
  TLDRAW_LICENSE_KEY?: string
}

const RUNTIME_CONFIG_PATH = '/api/runtime-config'
const RUNTIME_CONFIG_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === RUNTIME_CONFIG_PATH) {
      const licenseKey = env.TLDRAW_LICENSE_KEY?.trim()
      if (!licenseKey) {
        return Response.json(
          { error: 'TLDRAW_LICENSE_KEY is not configured.' },
          { status: 503, headers: RUNTIME_CONFIG_HEADERS },
        )
      }
      return Response.json(
        { tldrawLicenseKey: licenseKey },
        { headers: RUNTIME_CONFIG_HEADERS },
      )
    }
    if (url.pathname.startsWith('/api/official-library/')) {
      if (!env.DB) {
        return Response.json(
          { ok: false, error: { code: 'OFFICIAL_LIBRARY_UNAVAILABLE', message: 'The official recipe library is temporarily unavailable.' } },
          { status: 503, headers: { ...RUNTIME_CONFIG_HEADERS, 'Cache-Control': 'no-store' } },
        )
      }
      const response = await handleOfficialLibraryRequest(request, env.DB)
      if (response) return response
    }
    return env.ASSETS.fetch(request)
  },
}
