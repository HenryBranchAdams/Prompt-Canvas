import Ajv2020, { type ErrorObject } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import templateSchema from '../../schemas/prompt-workspace-template.schema.json'
import {
  createValidationResult,
  blockExtensionValidationErrors,
  normalizeTemplateInput,
  workflowValidationErrors,
} from './validation-core'
import type {
  PromptWorkspaceTemplate,
  TemplateValidationResult,
  ValidationIssue,
} from './types'

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateSchema = ajv.compile(templateSchema)

function toSchemaIssue(error: ErrorObject): ValidationIssue {
  const missing =
    error.keyword === 'required' && typeof error.params.missingProperty === 'string'
      ? `/${error.params.missingProperty}`
      : ''
  return {
    path: `${error.instancePath || '/'}${missing}`,
    code: `schema.${error.keyword}`,
    message: error.message ?? 'Schema validation failed.',
  }
}

export function validateTemplate(
  candidate: unknown,
  mode: 'schema-only' | 'compatibility' | 'full' = 'full',
): TemplateValidationResult {
  const normalizedCandidate = normalizeTemplateInput(candidate)
  const valid = validateSchema(normalizedCandidate)
  if (!valid) {
    return {
      valid: false,
      schemaErrors: (validateSchema.errors ?? []).map(toSchemaIssue),
      compatibilityWarnings: [],
      creativeSuggestions: [],
    }
  }
  const template = normalizedCandidate as PromptWorkspaceTemplate
  const semanticErrors = [
    ...workflowValidationErrors(template),
    ...blockExtensionValidationErrors(template),
  ]
  if (semanticErrors.length > 0) {
    return {
      valid: false,
      schemaErrors: semanticErrors,
      compatibilityWarnings: [],
      creativeSuggestions: [],
    }
  }
  return createValidationResult(structuredClone(template), mode)
}

export function assertValidTemplate(candidate: unknown): PromptWorkspaceTemplate {
  const result = validateTemplate(candidate, 'compatibility')
  if (!result.valid || !result.normalizedPreview) {
    const summary = result.schemaErrors.map((error) => `${error.path}: ${error.message}`).join('; ')
    throw new Error(`Invalid prompt workspace template: ${summary}`)
  }
  return result.normalizedPreview
}
