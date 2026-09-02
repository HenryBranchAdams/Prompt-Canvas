interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetsBinding
  TLDRAW_LICENSE_KEY?: string
}

const RUNTIME_CONFIG_PATH = '/api/runtime-config'
const RUNTIME_CONFIG_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === RUNTIME_CONFIG_PATH) {
      const licenseKey = env.TLDRAW_LICENSE_KEY?.trim()
      if (!licenseKey) {
        return Promise.resolve(Response.json(
          { error: 'TLDRAW_LICENSE_KEY is not configured.' },
          { status: 503, headers: RUNTIME_CONFIG_HEADERS },
        ))
      }
      return Promise.resolve(Response.json(
        { tldrawLicenseKey: licenseKey },
        { headers: RUNTIME_CONFIG_HEADERS },
      ))
    }
    return env.ASSETS.fetch(request)
  },
}
