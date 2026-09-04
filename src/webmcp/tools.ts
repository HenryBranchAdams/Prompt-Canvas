import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { webmcpCatalog } from '../generated/webmcpCatalog'
import type { PromptCanvasRuntime } from '../app/runtime'
import type {
  AssetSourceInput,
  GenerationOperation,
  JsonObject,
  OutputManagementOperation,
  WorkspaceUpdateOperation,
} from '../workspaces/types'
import type { WebMcpTool } from './registration'

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
addFormats(ajv)

function errorText(errors: typeof ajv.errors): string {
  return (errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ')
}

function toolFailure(name: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`${name} failed: ${message}`)
}

type InspectInput = { workspaceId?: string; include?: string[]; maxItems?: number }
type ListTemplatesInput = {
  query?: string
  scope?: 'official' | 'local' | 'all'
  categories?: string[]
  families?: string[]
  capabilities?: string[]
  intents?: string[]
  inputModes?: string[]
  subjectKinds?: string[]
  outputKinds?: string[]
  preservationNeeds?: string[]
  collections?: string[]
  limit?: number
}
type GetTemplateInput = {
  source?: 'official' | 'local'
  templateId: string
  version?: number
  expectedHash?: string
}
type ValidateTemplateInput = {
  template: unknown
  mode?: 'schema-only' | 'compatibility' | 'full'
}
type GenerationContextInput = {
  workspaceId: string
  operation: GenerationOperation
  outputSlotId?: string
  selectedOutputIds?: string[]
  chatDirection?: string
}
type CreateWorkspaceInput = {
  source:
    | {
        kind: 'template'
        origin?: 'official' | 'local'
        templateId: string
        version?: number
        expectedHash?: string
        values?: Record<string, unknown>
      }
    | { kind: 'definition'; template: unknown }
    | { kind: 'blank'; title: string; prompt?: string }
  placement?: 'new-page' | 'current-view' | 'beside-selection'
  openAfterCreate?: boolean
}
type UpdateWorkspaceInput = {
  workspaceId: string
  expectedRevision: number
  operations: WorkspaceUpdateOperation[]
  reason?: string
}
type DeleteWorkspaceInput = {
  workspaceId: string
  expectedRevision: number
  confirmed: true
}
type SaveTemplateInput = {
  source: { kind: 'workspace'; workspaceId: string } | { kind: 'definition'; template: unknown }
  title?: string
  mode: 'create' | 'new-version' | 'fork'
  expectedTemplateVersion?: number
}
type AddGeneratedAssetInput = {
  workspaceId: string
  requestId: string
  generationRevision: number
  assets: Array<{
    source: AssetSourceInput
    mimeType: string
    label?: string
    outputSlotId: string
    operation: GenerationOperation
    parentAssetIds?: string[]
    promptDigest: string
  }>
}
type ManageOutputsInput = {
  workspaceId: string
  expectedRevision: number
  operations: OutputManagementOperation[]
}

function handlerFor(name: string, runtime: PromptCanvasRuntime): (input: unknown) => unknown | Promise<unknown> {
  switch (name) {
    case 'prompt_canvas_inspect':
      return (input) => runtime.inspect(input as InspectInput)
    case 'prompt_canvas_list_templates':
      return (input) => runtime.listTemplatesAsync(input as ListTemplatesInput)
    case 'prompt_canvas_get_template':
      return async (input) => {
        const value = input as GetTemplateInput
        const resolved = await runtime.getTemplateAsync(value)
        const template = resolved.template
        return {
          template,
          validation: runtime.validateTemplate(template, 'full'),
          provenance: template.source ?? null,
          source: resolved.source,
          hash: resolved.hash ?? null,
        }
      }
    case 'prompt_canvas_validate_template':
      return (input) => {
        const value = input as ValidateTemplateInput
        return runtime.validateTemplate(value.template, value.mode ?? 'full')
      }
    case 'prompt_canvas_get_generation_context':
      return (input) => runtime.getGenerationContext(input as GenerationContextInput)
    case 'prompt_canvas_create_workspace':
      return async (input) => {
        const value = input as CreateWorkspaceInput
        const source =
          value.source.kind === 'template'
            ? {
                kind: 'template' as const,
                templateId: value.source.templateId,
                ...(value.source.origin ? { origin: value.source.origin } : {}),
                ...(value.source.version ? { version: value.source.version } : {}),
                ...(value.source.expectedHash ? { expectedHash: value.source.expectedHash } : {}),
                values: (value.source.values ?? {}) as JsonObject,
              }
            : value.source
        return runtime.createWorkspace(
          source,
          value.placement ?? 'new-page',
          value.openAfterCreate ?? true,
        )
      }
    case 'prompt_canvas_update_workspace':
      return (input) => runtime.updateWorkspace(input as UpdateWorkspaceInput)
    case 'prompt_canvas_delete_workspace':
      return (input) => runtime.deleteWorkspace(input as DeleteWorkspaceInput)
    case 'prompt_canvas_save_template':
      return (input) => runtime.saveTemplate(input as SaveTemplateInput)
    case 'prompt_canvas_add_generated_asset':
      return (input) => runtime.addGeneratedAssets(input as AddGeneratedAssetInput)
    case 'prompt_canvas_manage_outputs':
      return (input) => runtime.manageOutputs(input as ManageOutputsInput)
    default:
      return () => {
        throw new Error(`No implementation exists for WebMCP tool “${name}”.`)
      }
  }
}

export function createPromptCanvasWebMcpTools(runtime: PromptCanvasRuntime): WebMcpTool[] {
  return webmcpCatalog.tools.map((definition) => {
    const validate = ajv.compile(definition.inputSchema)
    const handler = handlerFor(definition.name, runtime)
    return {
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema as Record<string, unknown>,
      annotations: definition.annotations,
      async execute(input: unknown) {
        const candidate = input ?? {}
        if (!validate(candidate)) {
          throw new Error(`Invalid input for ${definition.name}: ${errorText(validate.errors)}`)
        }
        try {
          const result = await handler(candidate)
          if (!definition.annotations.readOnlyHint) runtime.clearLastError()
          return result
        } catch (error) {
          runtime.setLastError(error)
          toolFailure(definition.name, error)
        }
      },
    }
  })
}
