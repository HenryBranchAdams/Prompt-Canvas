function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true
  }

  const octets = normalized.split('.').map(Number)
  if (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  ) {
    const [first, second] = octets
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    )
  }

  if (normalized.includes(':')) {
    if (normalized === '::' || normalized === '::1') return true
    const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16)
    if ((firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80) return true
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
    if (mapped && isPrivateNetworkHostname(mapped)) return true
  }

  return false
}

/** Consume remote bytes incrementally; Content-Length is only an early hint. */
export async function fetchBoundedImage(
  url: URL,
  options: {
    maxBytes: number
    timeoutMs?: number
    fetchImpl?: typeof fetch
    allowedOrigins?: readonly string[]
  },
): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  const { maxBytes, timeoutMs = 30_000, fetchImpl = fetch, allowedOrigins = [] } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('The remote image byte limit must be a positive safe integer.')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('The remote image timeout must be positive.')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Remote image imports require a credential-free HTTPS URL.')
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new Error(`Remote image origin “${url.origin}” is not a trusted origin.`)
  }
  if (isPrivateNetworkHostname(url.hostname)) {
    throw new Error('Remote image imports cannot target a private network address.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Remote image download timed out.')), timeoutMs)
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const cancelReader = () => {
    // Cancellation is best-effort and must not replace the original failure.
    if (reader) void reader.cancel(controller.signal.reason).catch(() => undefined)
  }
  controller.signal.addEventListener('abort', cancelReader)
  try {
    response = await fetchImpl(url, {
      method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/png,image/jpeg,image/webp' }, signal: controller.signal,
    })
    controller.signal.throwIfAborted()
    if (!response.ok) throw new Error(`Image fetch failed with HTTP ${response.status}.`)
    if (Number(response.headers.get('content-length')) > maxBytes) {
      throw new Error('Remote image exceeds the configured byte limit.')
    }
    if (!response.body) throw new Error('Remote image response has no readable body.')
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      controller.signal.throwIfAborted()
      const { done, value } = await reader.read()
      controller.signal.throwIfAborted()
      if (done) break
      // Enforce the decoded stream size, including absent, false, or compressed
      // Content-Length headers, before retaining another chunk or joining bytes.
      if (value.byteLength > maxBytes - length) {
        throw new Error('Remote image exceeds the configured byte limit.')
      }
      chunks.push(value)
      length += value.byteLength
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim()
    return { bytes, ...(mimeType ? { mimeType } : {}) }
  } catch (error) {
    controller.abort(error)
    if (!reader && response?.body) void response.body.cancel(error).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', cancelReader)
    reader?.releaseLock()
  }
}
