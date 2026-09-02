import type { JsonValue } from './types.js'

export function stableStringify(value: JsonValue | unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digestInput = new Uint8Array(data.byteLength)
  digestInput.set(data)
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function shortHash(value: unknown): string {
  const input = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
