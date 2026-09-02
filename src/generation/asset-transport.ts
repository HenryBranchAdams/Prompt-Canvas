import { fetchBoundedImage } from './bounded-image-fetch.js'
import {
  decodeDataUrl,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGE_PIXELS,
  validateImageBytes,
} from './asset-validation-core'
import type {
  AssetSourceInput,
  AssetTransportKind,
  ImportedImage,
} from '../workspaces/types'

export type HostAttachmentResolution = {
  dataUrl?: string
  bytes?: Uint8Array
  mimeType?: string
}

export type PromptCanvasHostBridge = {
  verified?: boolean
  resolveAttachment?: (token: string) => Promise<HostAttachmentResolution>
}

declare global {
  interface Window {
    promptCanvasHost?: PromptCanvasHostBridge
  }
}

// HTTPS stays disabled until a deployed desktop-host qualification records a
// specific trusted origin. An empty list is intentionally fail-closed.
const VERIFIED_HTTPS_ORIGINS: readonly string[] = []
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export class AssetTransportRegistry {
  private verified = new Set<AssetTransportKind>()

  async initialize(): Promise<void> {
    // Host-dependent transports must be re-qualified for every live page. A
    // result from a previous browser or deployment is not evidence that the
    // current Codex host exposes the same attachment or network bridge.
    this.verified.clear()
    await this.verifyDataUrlTransport()
    // Host attachments remain schema-compatible but intentionally disabled
    // until this exact adapter and host build receive a recorded qualification.
  }

  getVerified(): AssetTransportKind[] {
    return [...this.verified].sort()
  }

  isVerified(kind: AssetTransportKind): boolean {
    return this.verified.has(kind)
  }

  private async verifyDataUrlTransport(): Promise<void> {
    try {
      const { bytes, declaredMimeType } = decodeDataUrl(TINY_PNG)
      await validateImageBytes({
        bytes,
        declaredMimeType,
        sourceKind: 'data_url',
        maxBytes: 1024,
        maxPixels: 4,
      })
      this.verified.add('data_url')
    } catch {
      this.verified.delete('data_url')
    }
  }

}

export async function resolveAssetSource(input: {
  source: AssetSourceInput
  registry: AssetTransportRegistry
  declaredMimeType?: string
  maxBytes?: number
  maxPixels?: number
}): Promise<ImportedImage> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES
  const maxPixels = input.maxPixels ?? DEFAULT_MAX_IMAGE_PIXELS
  const kind = input.source.kind
  if (!input.registry.isVerified(kind)) {
    throw new Error(`Asset transport “${kind}” has not been verified in this host.`)
  }

  if (input.source.kind === 'data_url') {
    const { bytes, declaredMimeType } = decodeDataUrl(input.source.dataUrl, maxBytes)
    return validateImageBytes({
      bytes,
      declaredMimeType: input.declaredMimeType ?? declaredMimeType,
      sourceKind: 'data_url',
      maxBytes,
      maxPixels,
    })
  }

  if (input.source.kind === 'host_attachment') {
    const resolver = window.promptCanvasHost?.resolveAttachment
    if (!resolver) throw new Error('The host attachment adapter is not available.')
    const resolved = await resolver(input.source.token)
    if (resolved.dataUrl) {
      const { bytes, declaredMimeType } = decodeDataUrl(resolved.dataUrl, maxBytes)
      return validateImageBytes({
        bytes,
        declaredMimeType: input.declaredMimeType ?? resolved.mimeType ?? declaredMimeType,
        sourceKind: 'host_attachment',
        maxBytes,
        maxPixels,
      })
    }
    if (resolved.bytes) {
      const mimeType = input.declaredMimeType ?? resolved.mimeType
      const validated = await validateImageBytes({
        bytes: resolved.bytes,
        ...(mimeType ? { declaredMimeType: mimeType } : {}),
        sourceKind: 'host_attachment',
        maxBytes,
        maxPixels,
      })
      return validated
    }
    throw new Error('The host attachment adapter returned no image bytes.')
  }

  const remoteUrl = new URL(input.source.url)
  if (remoteUrl.protocol !== 'https:' || remoteUrl.username || remoteUrl.password) {
    throw new Error('Remote image imports require a credential-free HTTPS URL.')
  }
  const { bytes, mimeType } = await fetchBoundedImage(remoteUrl, {
    maxBytes,
    allowedOrigins: VERIFIED_HTTPS_ORIGINS,
  })
  const declaredMimeType = input.declaredMimeType ?? mimeType
  const validated = await validateImageBytes({
    bytes,
    ...(declaredMimeType ? { declaredMimeType } : {}),
    sourceKind: 'https_url',
    maxBytes,
    maxPixels,
  })
  return validated
}
