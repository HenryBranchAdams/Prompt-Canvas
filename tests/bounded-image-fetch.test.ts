import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchBoundedImage } from '../src/generation/bounded-image-fetch.js'

const url = new URL('https://images.example.test/output.png')

function streamed(chunks: number[][], headers: HeadersInit = {}) {
  let cancelled = false
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift()
      if (next) controller.enqueue(new Uint8Array(next))
      else controller.close()
    },
    cancel() { cancelled = true },
  }), { headers })
  return { response, wasCancelled: () => cancelled }
}

test('remote image downloads require an explicitly trusted origin', async () => {
  let fetched = false
  await assert.rejects(fetchBoundedImage(url, {
    maxBytes: 10,
    fetchImpl: async () => {
      fetched = true
      return new Response(new Uint8Array([1]))
    },
  }), /trusted origin/)
  assert.equal(fetched, false)
})

test('trusted-origin configuration cannot allow private-network targets', async () => {
  const privateUrls = [
    'https://localhost/output.png',
    'https://127.0.0.1/output.png',
    'https://10.0.0.8/output.png',
    'https://172.16.0.8/output.png',
    'https://192.168.0.8/output.png',
    'https://169.254.169.254/output.png',
    'https://[::1]/output.png',
    'https://[fd00::8]/output.png',
    'https://[fe80::8]/output.png',
  ]
  let fetched = false
  for (const value of privateUrls) {
    const privateUrl = new URL(value)
    await assert.rejects(fetchBoundedImage(privateUrl, {
      maxBytes: 10,
      allowedOrigins: [privateUrl.origin],
      fetchImpl: async () => {
        fetched = true
        return new Response(new Uint8Array([1]))
      },
    }), /private network/)
  }
  assert.equal(fetched, false)
})

test('a chunked response without Content-Length cannot exceed the byte cap', async () => {
  const stream = streamed([[1, 2, 3], [4, 5, 6], [7]])
  let signal: AbortSignal | null | undefined
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 5,
    allowedOrigins: [url.origin],
    fetchImpl: async (_url, init) => { signal = init?.signal; return stream.response },
  }), /byte limit/)
  assert.equal(signal?.aborted, true)
  assert.equal(stream.wasCancelled(), true)
})

test('understated Content-Length cannot bypass the streaming cap', async () => {
  const stream = streamed([[1, 2, 3, 4]], { 'Content-Length': '1' })
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 3,
    allowedOrigins: [url.origin],
    fetchImpl: async () => stream.response,
  }), /byte limit/)
})

test('an advertised oversized response is cancelled before body consumption', async () => {
  const stream = streamed([[1]], { 'Content-Length': '100' })
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 5,
    allowedOrigins: [url.origin],
    fetchImpl: async () => stream.response,
  }), /byte limit/)
  assert.equal(stream.wasCancelled(), true)
})

test('a response at the exact limit is preserved without credentials or redirects', async () => {
  const stream = streamed([[1, 2], [3]], { 'Content-Type': 'image/png; charset=binary' })
  let request: RequestInit | undefined
  const result = await fetchBoundedImage(url, { maxBytes: 3,
    allowedOrigins: [url.origin],
    fetchImpl: async (_url, init) => { request = init; return stream.response },
  })
  assert.deepEqual([...result.bytes], [1, 2, 3])
  assert.equal(result.mimeType, 'image/png')
  assert.equal(request?.credentials, 'omit')
  assert.equal(request?.redirect, 'error')
  assert.equal(request?.referrerPolicy, 'no-referrer')
})

test('a stalled response body times out and is cancelled', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }))
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 100, timeoutMs: 10,
    allowedOrigins: [url.origin],
    fetchImpl: async () => response,
  }), /timed out/)
  assert.equal(cancelled, true)
})

test('HTTP errors and stream failures propagate rather than importing partial data', async () => {
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 100,
    allowedOrigins: [url.origin],
    fetchImpl: async () => new Response(null, { status: 404 }),
  }), /HTTP 404/)
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error('broken download')) },
  }))
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 100,
    allowedOrigins: [url.origin],
    fetchImpl: async () => response,
  }), /broken download/)
})

test('invalid limits and URLs are rejected before fetching', async () => {
  let fetched = false
  const fetchImpl: typeof fetch = async () => { fetched = true; return new Response(null) }
  await assert.rejects(fetchBoundedImage(url, { maxBytes: 0, allowedOrigins: [url.origin], fetchImpl }), /positive safe integer/)
  await assert.rejects(fetchBoundedImage(new URL('http://images.example.test/a.png'), { maxBytes: 10, allowedOrigins: [url.origin], fetchImpl }), /HTTPS/)
  await assert.rejects(fetchBoundedImage(new URL('https://user:secret@images.example.test/a.png'), { maxBytes: 10, allowedOrigins: [url.origin], fetchImpl }), /credential-free/)
  assert.equal(fetched, false)
})
