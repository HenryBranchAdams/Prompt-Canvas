import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AssetValidationError,
  decodeDataUrl,
  sniffImage,
  validateImageBytes,
} from '../src/generation/asset-validation-core.js'

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('data URL transport decodes and validates real PNG bytes', async () => {
  const { bytes, declaredMimeType } = decodeDataUrl(TINY_PNG)
  assert.equal(declaredMimeType, 'image/png')
  assert.deepEqual(sniffImage(bytes), { mimeType: 'image/png', width: 1, height: 1 })
  const image = await validateImageBytes({
    bytes,
    declaredMimeType,
    sourceKind: 'data_url',
  })
  assert.equal(image.width, 1)
  assert.equal(image.height, 1)
  assert.equal(image.byteDigest.length, 64)
})

test('MIME mismatches fail closed', async () => {
  const { bytes } = decodeDataUrl(TINY_PNG)
  await assert.rejects(
    validateImageBytes({
      bytes,
      declaredMimeType: 'image/jpeg',
      sourceKind: 'data_url',
    }),
    (error: unknown) => error instanceof AssetValidationError && error.code === 'image.mime-mismatch',
  )
})

test('oversized data URLs fail before base64 decoding', () => {
  assert.throws(
    () => decodeDataUrl(`data:image/png;base64,${'A'.repeat(20)}`, 3),
    (error: unknown) =>
      error instanceof AssetValidationError && error.code === 'transport.data-url-too-large',
  )
})
