const RANDOM_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

function randomPart(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let output = ''
  for (const byte of bytes) output += RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length]
  return output
}

export function createWorkspaceId(): string {
  return `ws_${Date.now().toString(36)}_${randomPart(10)}`
}

export function createGenerationRequestId(): string {
  return `genreq_${Date.now().toString(36)}_${randomPart(10)}`
}

export function createActivityId(): string {
  return `activity_${Date.now().toString(36)}_${randomPart(8)}`
}

export function createUserTemplateId(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return `${slug || 'prompt-template'}-${randomPart(6)}`
}
