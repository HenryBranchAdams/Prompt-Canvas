import type { JsonValue, PromptWorkspaceTemplate } from '../workspaces/types.js'

export function slugifyTemplateId(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
  return slug.length >= 2 ? slug : `template-${Date.now().toString(36)}`
}

export function createBlankTemplate(title: string, prompt = ''): PromptWorkspaceTemplate {
  const id = slugifyTemplateId(title)
  return {
    schema: 'prompt-canvas.prompt-workspace-template@2',
    id,
    version: 1,
    title,
    description: 'An open prompt workspace created in Prompt Canvas.',
    category: 'user-library',
    tags: ['open', 'user-created'],
    status: 'draft',
    compatibility: { minimumAppVersion: '0.1.0', templateFamily: 'open' },
    capabilities: ['text-to-image', 'image-edit', 'variations', 'upscale'],
    generation: {
      provider: 'codex',
      capability: 'image-generation',
      delivery: 'webmcp-import',
      operations: ['generate', 'edit', 'variation', 'upscale'],
      defaultOperation: 'generate',
      defaultVariationCount: 4,
      preferredMimeTypes: ['image/png', 'image/webp'],
    },
    prompt: { title, body: prompt },
    controls: [
      {
        id: 'aspect-ratio',
        label: 'Aspect ratio',
        type: 'aspect-ratio',
        defaultValue: 'auto',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: '1:1', value: '1:1' },
          { label: '3:4', value: '3:4' },
          { label: '4:3', value: '4:3' },
          { label: '16:9', value: '16:9' },
        ],
        binding: { mode: 'generation', target: 'aspectRatio' },
      },
    ],
    outputs: [
      {
        id: 'primary',
        label: 'Primary image',
        role: 'primary',
        kind: 'image',
        count: 1,
        layoutHint: 'hero',
      },
      {
        id: 'variations',
        label: 'Variations',
        role: 'variation',
        kind: 'image-set',
        count: 4,
        layoutHint: 'strip',
      },
    ],
    layout: {
      mode: 'auto',
      arrangement: 'prompt-left-output-right',
      preserveManualGeometry: true,
    },
    source: {
      kind: 'user-provided',
      title,
      promptUsage: 'original',
    },
    'x-prompt-canvas': { blank: true } as JsonValue,
  }
}
