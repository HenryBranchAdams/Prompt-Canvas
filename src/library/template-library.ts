import { starterManifest, starterTemplates } from '../generated/starterTemplates'
import type { PromptCanvasDatabase } from '../persistence/database'
import { searchTemplates, type TemplateSearchRecord } from '../workspaces/template-search'
import type {
  PromptWorkspaceTemplate,
  TemplateManifestEntry,
  TemplateValidationResult,
} from '../workspaces/types'
import { validateTemplate } from '../workspaces/validation'
import { slugifyTemplateId } from './template-library-core'
export { createBlankTemplate } from './template-library-core'

export type SaveTemplateMode = 'create' | 'new-version' | 'fork'

function userEntry(template: PromptWorkspaceTemplate, order: number): TemplateManifestEntry {
  return {
    id: template.id,
    path: `indexeddb://${template.id}/${template.version}`,
    title: template.title,
    description: template.description,
    category: template.category ?? 'user-library',
    family: template.compatibility?.templateFamily ?? 'open',
    operations: template.generation.operations,
    capabilities: template.capabilities ?? template.compatibility?.requiresCapabilities ?? [],
    featured: false,
    order,
    ...(template.source
      ? {
          source: {
            ...(template.source.creator ? { creator: template.source.creator } : {}),
            title: template.source.title,
            ...(template.source.url !== undefined ? { url: template.source.url } : {}),
            promptUsage: template.source.promptUsage,
          },
        }
      : {}),
  }
}

export class TemplateLibrary {
  private userTemplates = new Map<string, PromptWorkspaceTemplate[]>()

  constructor(private readonly database: PromptCanvasDatabase) {}

  async initialize(): Promise<void> {
    const templates = await this.database.listTemplates()
    for (const template of templates) this.insertUserTemplate(template)
  }

  private insertUserTemplate(template: PromptWorkspaceTemplate): void {
    const versions = this.userTemplates.get(template.id) ?? []
    const withoutSame = versions.filter((candidate) => candidate.version !== template.version)
    withoutSame.push(structuredClone(template))
    withoutSame.sort((a, b) => b.version - a.version)
    this.userTemplates.set(template.id, withoutSame)
  }

  listRecords(): TemplateSearchRecord[] {
    const starterRecords = starterManifest.templates.map((entry) => ({
      entry: entry as TemplateManifestEntry,
      template: starterTemplates[entry.id] as PromptWorkspaceTemplate,
    }))
    const userRecords: TemplateSearchRecord[] = []
    let order = 1000
    for (const versions of this.userTemplates.values()) {
      const current = versions[0]
      if (!current) continue
      userRecords.push({ entry: userEntry(current, order++), template: structuredClone(current) })
    }
    return [...starterRecords, ...userRecords]
  }

  search(
    query = '',
    filters: { family?: string; category?: string; capability?: string; operation?: string } = {},
  ): TemplateSearchRecord[] {
    return searchTemplates(this.listRecords(), query, filters)
  }

  get(templateId: string, version?: number): PromptWorkspaceTemplate | undefined {
    const starter = starterTemplates[templateId as keyof typeof starterTemplates]
    if (starter && (version === undefined || starter.version === version)) {
      return structuredClone(starter) as PromptWorkspaceTemplate
    }
    const versions = this.userTemplates.get(templateId) ?? []
    const template = version === undefined ? versions[0] : versions.find((item) => item.version === version)
    return template ? structuredClone(template) : undefined
  }

  async save(input: {
    template: PromptWorkspaceTemplate
    mode: SaveTemplateMode
    title?: string
    expectedTemplateVersion?: number
  }): Promise<{ template: PromptWorkspaceTemplate; validation: TemplateValidationResult }> {
    const validation = validateTemplate(input.template, 'full')
    if (!validation.valid || !validation.normalizedPreview) {
      throw new Error(
        `Template validation failed: ${validation.schemaErrors.map((item) => item.message).join('; ')}`,
      )
    }

    const candidate = structuredClone(validation.normalizedPreview)
    if (input.title) candidate.title = input.title
    const starterExists = Boolean(starterTemplates[candidate.id as keyof typeof starterTemplates])
    const existing = this.userTemplates.get(candidate.id) ?? []
    const reviewedSource = candidate.source ?? existing[0]?.source

    if (input.mode === 'fork' || (input.mode === 'create' && (starterExists || existing.length > 0))) {
      candidate.id = this.uniqueId(`${slugifyTemplateId(input.title ?? candidate.title)}-fork`)
      candidate.version = 1
    } else if (input.mode === 'create') {
      candidate.id = this.uniqueId(slugifyTemplateId(candidate.id || candidate.title))
      candidate.version = 1
    } else {
      const latest = existing[0]
      if (!latest) throw new Error('A new version requires an existing user-owned template.')
      if (
        input.expectedTemplateVersion !== undefined &&
        latest.version !== input.expectedTemplateVersion
      ) {
        throw new Error(
          `Stale template version: expected ${input.expectedTemplateVersion}, current version is ${latest.version}.`,
        )
      }
      candidate.id = latest.id
      candidate.version = latest.version + 1
    }

    candidate.status = 'published'
    // Preserve reviewed attribution and inert provenance extensions from the
    // candidate (or the current version). Only source-free templates receive a
    // user-owned fallback source record.
    candidate.source = reviewedSource
      ? structuredClone(reviewedSource)
      : {
          kind: 'user-provided',
          title: candidate.title,
          promptUsage: 'original',
          notes: 'Saved from Prompt Canvas as a user-owned template.',
        }

    await this.database.saveTemplate(candidate)
    this.insertUserTemplate(candidate)
    return { template: structuredClone(candidate), validation }
  }

  private uniqueId(base: string): string {
    let id = base
    let suffix = 2
    while (this.get(id)) id = `${base}-${suffix++}`
    return id
  }
}
