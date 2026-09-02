import type { PromptWorkspaceTemplate, TemplateManifestEntry } from './types.js'

export type TemplateSearchRecord = {
  entry: TemplateManifestEntry
  template: PromptWorkspaceTemplate
}

function searchable(record: TemplateSearchRecord): string {
  const { entry, template } = record
  return [
    entry.id,
    entry.title,
    entry.description,
    entry.category,
    entry.family,
    ...entry.operations,
    ...entry.capabilities,
    ...(template.tags ?? []),
    template.prompt.body,
    template.source?.creator ?? '',
    template.source?.title ?? '',
  ]
    .join(' ')
    .toLocaleLowerCase()
}

export function searchTemplates(
  records: TemplateSearchRecord[],
  query = '',
  filters: {
    family?: string
    category?: string
    capability?: string
    operation?: string
  } = {},
): TemplateSearchRecord[] {
  const terms = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)

  return records
    .filter(({ entry }) => !filters.family || entry.family === filters.family)
    .filter(({ entry }) => !filters.category || entry.category === filters.category)
    .filter(({ entry }) => !filters.capability || entry.capabilities.includes(filters.capability as never))
    .filter(({ entry }) => !filters.operation || entry.operations.includes(filters.operation as never))
    .filter((record) => {
      if (terms.length === 0) return true
      const haystack = searchable(record)
      return terms.every((term) => haystack.includes(term))
    })
    .sort((a, b) => a.entry.order - b.entry.order || a.entry.title.localeCompare(b.entry.title))
}
