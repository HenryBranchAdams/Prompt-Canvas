import type { ImportedImage } from '../workspaces/types.js'

export const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const DEFAULT_MAX_IMAGE_PIXELS = 32_000_000
export const DEFAULT_MAX_IMAGES_PER_IMPORT = 8

export class AssetValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AssetValidationError'
  }
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0)
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 256 + (bytes[offset + 2] ?? 0) * 65_536
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  ) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

export function sniffImage(bytes: Uint8Array): {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
} {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: 'image/png', width: uint32be(bytes, 16), height: uint32be(bytes, 20) }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      let marker = bytes[offset + 1] ?? 0
      while (marker === 0xff) {
        offset += 1
        marker = bytes[offset + 1] ?? 0
      }
      offset += 2
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue
      const segmentLength = uint16be(bytes, offset)
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof && segmentLength >= 7) {
        return {
          mimeType: 'image/jpeg',
          height: uint16be(bytes, offset + 3),
          width: uint16be(bytes, offset + 5),
        }
      }
      offset += segmentLength
    }
    throw new AssetValidationError('JPEG dimensions could not be read.', 'image.invalid-jpeg')
  }

  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP'
  ) {
    const chunk = ascii(bytes, 12, 4)
    if (chunk === 'VP8X') {
      return {
        mimeType: 'image/webp',
        width: 1 + uint24le(bytes, 24),
        height: 1 + uint24le(bytes, 27),
      }
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21] ?? 0
      const b2 = bytes[22] ?? 0
      const b3 = bytes[23] ?? 0
      const b4 = bytes[24] ?? 0
      return {
        mimeType: 'image/webp',
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      }
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return {
        mimeType: 'image/webp',
        width: uint16be(new Uint8Array([bytes[27] ?? 0, bytes[26] ?? 0]), 0) & 0x3fff,
        height: uint16be(new Uint8Array([bytes[29] ?? 0, bytes[28] ?? 0]), 0) & 0x3fff,
      }
    }
    throw new AssetValidationError('WebP dimensions could not be read.', 'image.invalid-webp')
  }

  throw new AssetValidationError(
    'Only PNG, JPEG, and WebP image bytes are accepted.',
    'image.unsupported-format',
  )
}

export function decodeDataUrl(
  dataUrl: string,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
): { bytes: Uint8Array; declaredMimeType: string } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) {
    throw new AssetValidationError(
      'Image data URLs must be base64-encoded and declare an image MIME type.',
      'transport.invalid-data-url',
    )
  }
  const declaredMimeType = match[1]?.toLocaleLowerCase() ?? ''
  const encoded = (match[2] ?? '').replace(/\s+/g, '')
  // Four base64 characters represent at most three decoded bytes. Reject the
  // payload before `atob` so an oversized tool argument cannot force a large
  // transient allocation before normal byte validation runs.
  const maximumEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4
  if (encoded.length > maximumEncodedLength) {
    throw new AssetValidationError(
      `Image data URL exceeds the ${maxBytes}-byte decoded limit.`,
      'transport.data-url-too-large',
    )
  }
  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    throw new AssetValidationError('Image data URL is not valid base64.', 'transport.invalid-base64')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { bytes, declaredMimeType }
}

export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength)
  digestInput.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function validateImageBytes(input: {
  bytes: Uint8Array
  declaredMimeType?: string
  sourceKind: ImportedImage['sourceKind']
  maxBytes?: number
  maxPixels?: number
}): Promise<ImportedImage> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES
  const maxPixels = input.maxPixels ?? DEFAULT_MAX_IMAGE_PIXELS
  if (input.bytes.length === 0) {
    throw new AssetValidationError('Image payload is empty.', 'image.empty')
  }
  if (input.bytes.length > maxBytes) {
    throw new AssetValidationError(
      `Image payload exceeds the ${maxBytes}-byte limit.`,
      'image.too-large',
    )
  }
  const detected = sniffImage(input.bytes)
  if (
    input.declaredMimeType &&
    input.declaredMimeType !== detected.mimeType &&
    !(input.declaredMimeType === 'image/jpg' && detected.mimeType === 'image/jpeg')
  ) {
    throw new AssetValidationError(
      `Declared MIME type ${input.declaredMimeType} does not match ${detected.mimeType} bytes.`,
      'image.mime-mismatch',
    )
  }
  if (detected.width < 1 || detected.height < 1) {
    throw new AssetValidationError('Image dimensions must be positive.', 'image.invalid-dimensions')
  }
  if (detected.width * detected.height > maxPixels) {
    throw new AssetValidationError(
      `Image exceeds the ${maxPixels}-pixel limit.`,
      'image.too-many-pixels',
    )
  }
  if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
    try {
      const bytes = input.bytes.slice()
      const bitmap = await createImageBitmap(new Blob([bytes], { type: detected.mimeType }))
      const decodedWidth = bitmap.width
      const decodedHeight = bitmap.height
      bitmap.close()
      if (decodedWidth !== detected.width || decodedHeight !== detected.height) {
        throw new AssetValidationError(
          'Decoded image dimensions do not match the file header.',
          'image.dimension-mismatch',
        )
      }
    } catch (error) {
      if (error instanceof AssetValidationError) throw error
      throw new AssetValidationError('Image bytes could not be decoded.', 'image.decode-failed')
    }
  }
  return {
    sourceKind: input.sourceKind,
    bytes: input.bytes,
    mimeType: detected.mimeType,
    width: detected.width,
    height: detected.height,
    byteLength: input.bytes.length,
    byteDigest: await digestBytes(input.bytes),
  }
}
