import assert from 'node:assert/strict'
import test from 'node:test'
import { starterManifest, starterTemplates } from '../src/generated/starterTemplates.js'
import { resolveGenerationContext } from '../src/workspaces/prompt-resolver.js'
import { createWorkspaceManifest } from '../src/workspaces/workspace-factory.js'
import type {
  JsonValue,
  PromptWorkspaceTemplate,
  StarterManifest,
} from '../src/workspaces/types.js'

const scenarios = [
  {
    templateId: 'retail-object-family-study',
    values: { product_family: 'an unscented skincare trio' },
    expected: 'unscented skincare trio',
    forbidden: ['north window', 'botanical tea', 'refill carton', 'marigold navigation', 'deep pine'],
  },
  {
    templateId: 'scene-rhythm-board',
    values: { premise: 'a quiet kitchen comedy' },
    expected: 'quiet kitchen comedy',
    forbidden: ['museum', 'conservator', 'mechanical bird', 'copper inspection lamp', 'glass display case', 'pre-dawn'],
  },
  {
    templateId: 'object-logic-atlas',
    values: { subject: 'a manual espresso machine' },
    expected: 'manual espresso machine',
    forbidden: ['rainwater', 'runoff channel', 'leaf screen', 'storage chamber', 'public courtyard'],
  },
  {
    templateId: 'learning-trail-map',
    values: { topic: 'a home computer network' },
    expected: 'home computer network',
    forbidden: ['wetland', 'stormwater', 'reed bed', 'park steward', 'observation deck', 'neighborhood wildlife'],
  },
] as const

const manifest = starterManifest as unknown as StarterManifest

for (const scenario of scenarios) {
  test(`${scenario.templateId} does not leak unrelated starter details when its primary subject changes`, () => {
    const template = structuredClone(
      starterTemplates[scenario.templateId],
    ) as unknown as PromptWorkspaceTemplate
    const workspace = createWorkspaceManifest(
      template,
      scenario.values as Record<string, JsonValue>,
      '2026-08-30T00:00:00.000Z',
    )
    const context = resolveGenerationContext({
      manifest: workspace,
      template,
      rawPrompt: template.prompt.body,
      controlValues: workspace.controlValues,
      verifiedAssetTransports: ['data_url'],
      requestId: `test-${scenario.templateId}`,
    })

    const resolved = context.resolvedPrompt.toLowerCase()
    assert.ok(resolved.includes(scenario.expected))
    for (const token of scenario.forbidden) {
      assert.equal(
        resolved.includes(token),
        false,
        `${scenario.templateId} leaked unrelated starter detail: ${token}`,
      )
    }

    const manifestEntry = manifest.templates.find((entry) => entry.id === scenario.templateId)
    assert.ok(manifestEntry)
    assert.equal(manifestEntry.featured, false)
    assert.equal(template.version, 2)
  })
}
