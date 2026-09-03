type RuntimeLicenseOptions = {
  bundledKey?: string
  development: boolean
  signal: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_RUNTIME_LICENSE_TIMEOUT_MS = 12_000

export async function loadTldrawLicenseKey({
  bundledKey,
  development,
  signal,
  timeoutMs = DEFAULT_RUNTIME_LICENSE_TIMEOUT_MS,
  fetchImpl = fetch,
}: RuntimeLicenseOptions): Promise<string | undefined> {
  if (bundledKey) return bundledKey
  // The SDK's development mode is intentionally keyless. Avoid a guaranteed
  // 503 from the production-only worker binding so local first run stays quiet.
  if (development) return undefined
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('The tldraw production license timeout must be positive.')
  }

  const requestController = new AbortController()
  const forwardAbort = () => requestController.abort(signal.reason)
  if (signal.aborted) forwardAbort()
  else signal.addEventListener('abort', forwardAbort, { once: true })

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error('The tldraw production license request timed out.')
      requestController.abort(error)
      reject(error)
    }, timeoutMs)
  })

  const request = async (): Promise<string | undefined> => {
    const response = await fetchImpl('/api/runtime-config', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: requestController.signal,
    })
    if (!response.ok) throw new Error('The tldraw production license is unavailable.')

    const payload: unknown = await response.json()
    const key = payload && typeof payload === 'object'
      ? (payload as { tldrawLicenseKey?: unknown }).tldrawLicenseKey
      : undefined
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('The tldraw production license response is invalid.')
    }
    return key.trim()
  }

  try {
    return await Promise.race([request(), timeout])
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    signal.removeEventListener('abort', forwardAbort)
  }
}
