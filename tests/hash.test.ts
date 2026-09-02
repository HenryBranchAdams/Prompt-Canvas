import assert from 'node:assert/strict'
import test from 'node:test'
import { digestBytes } from '../src/generation/asset-validation-core.js'
import { sha256Hex } from '../src/workspaces/hash.js'

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

test('WebCrypto hashing accepts bytes backed by SharedArrayBuffer', async () => {
  const bytes = new Uint8Array(new SharedArrayBuffer(3))
  bytes.set([0x61, 0x62, 0x63])

  assert.equal(await digestBytes(bytes), SHA256_ABC)
  assert.equal(await sha256Hex(bytes), SHA256_ABC)
})
