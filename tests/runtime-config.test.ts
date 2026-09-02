import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTldrawLicenseKey } from '../src/app/runtime-license.js'
import worker from '../worker/index.js'

const assets = {
  fetch: async () => new Response('unexpected asset response', { status: 418 }),
}

test('the worker exposes the configured tldraw key through a no-store runtime response', async () => {
  const response = await worker.fetch(
    new Request('https://prompt-canvas.example/api/runtime-config'),
    { ASSETS: assets, TLDRAW_LICENSE_KEY: 'tldraw-test-license' },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(await response.json(), { tldrawLicenseKey: 'tldraw-test-license' })
})

test('the worker fails closed when the production tldraw key is missing', async () => {
  const response = await worker.fetch(
    new Request('https://prompt-canvas.example/api/runtime-config'),
    { ASSETS: assets },
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), {
    error: 'TLDRAW_LICENSE_KEY is not configured.',
  })
})

test('a stalled runtime-license response fails visibly within the configured bound', async () => {
  const delayedFetch: typeof fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return Response.json({ tldrawLicenseKey: 'late-license' })
  }

  await assert.rejects(
    loadTldrawLicenseKey({
      development: false,
      signal: new AbortController().signal,
      timeoutMs: 10,
      fetchImpl: delayedFetch,
    }),
    /timed out/i,
  )
})
