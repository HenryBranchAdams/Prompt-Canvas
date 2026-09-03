from __future__ import annotations

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} match, found {count}.")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[1]
app_path = root / "src/app/App.tsx"
panel_path = root / "src/shapes/panel-shape.tsx"
styles_path = root / "src/styles.css"
e2e_path = root / "e2e/prompt-canvas.spec.ts"

app = app_path.read_text(encoding="utf-8")
old_preview = '''function generationPreview(context: GenerationContext): RequestPreviewItem[] {
  const entries = Object.entries(context.controlContext)
    .flatMap(([key, value]) => {
      const rendered = compactPreviewValue(value)
      return rendered ? [{ key, label: humanizePreviewKey(key), value: rendered }] : []
    })
  const brief = entries.find((entry) => /brief|subject|description|prompt/i.test(entry.key))
  const direction = entries
    .filter((entry) => entry !== brief && !/aspect|ratio|format/i.test(entry.key))
    .slice(0, 3)
    .map((entry) => entry.value)
    .join(' · ')

  return [
    ...(brief ? [{ label: 'Brief', value: brief.value }] : []),
    ...(direction ? [{ label: 'Direction', value: direction }] : []),
    { label: 'Format', value: context.outputRequirements.aspectRatio },
    {
      label: 'References',
      value: context.references.length > 0
        ? `${context.references.length} attached`
        : 'None attached',
    },
  ]
}
'''
new_preview = '''function generationPreview(
  context: GenerationContext,
  project: RuntimeSnapshot['activeWorkspace'],
): RequestPreviewItem[] {
  const projectEntries = (project?.templateSnapshot.controls ?? []).flatMap((control) => {
    const valueKey = control.binding.mode === 'variable' ? control.binding.target : control.id
    const rendered = compactPreviewValue(project?.controlValues[valueKey] ?? control.defaultValue)
    return rendered ? [{ key: control.id, label: control.label, value: rendered }] : []
  })
  const contextEntries = Object.entries(context.controlContext).flatMap(([key, value]) => {
    const rendered = compactPreviewValue(value)
    return rendered ? [{ key, label: humanizePreviewKey(key), value: rendered }] : []
  })
  const entries = projectEntries.length > 0 ? projectEntries : contextEntries
  const brief = entries.find((entry) => /brief|subject|description|prompt|image/i.test(`${entry.key} ${entry.label}`))
  const direction = entries
    .filter((entry) => entry !== brief && !/aspect|ratio|format/i.test(`${entry.key} ${entry.label}`))
    .slice(0, 3)
    .map((entry) => entry.value)
    .join(' · ')

  return [
    ...(brief ? [{ label: 'Brief', value: brief.value }] : []),
    ...(direction ? [{ label: 'Direction', value: direction }] : []),
    { label: 'Format', value: context.outputRequirements.aspectRatio },
    {
      label: 'References',
      value: context.references.length > 0
        ? `${context.references.length} attached`
        : 'None attached',
    },
  ]
}
'''
app = replace_once(app, old_preview, new_preview, "generation preview")
old_generation_header = '''function GenerationDialog({
  context,
  onClose,
}: {
  context: GenerationContext
  onClose: () => void
}) {'''
new_generation_header = '''function GenerationDialog({
  context,
  project,
  onClose,
}: {
  context: GenerationContext
  project: RuntimeSnapshot['activeWorkspace']
  onClose: () => void
}) {'''
app = replace_once(app, old_generation_header, new_generation_header, "generation dialog header")
app = replace_once(
    app,
    "      preview={generationPreview(context)}",
    "      preview={generationPreview(context, project)}",
    "generation preview call",
)
app = replace_once(
    app,
    "          context={snapshot.preparedContext}\n          onClose={closeGenerationDialog}",
    "          context={snapshot.preparedContext}\n          project={active}\n          onClose={closeGenerationDialog}",
    "generation dialog project value",
)
app = app.replace("Request for ChatGPT", "Message for Codex")
app_path.write_text(app, encoding="utf-8")

panel = panel_path.read_text(encoding="utf-8")
old_cues = '''function collaborationCue(kind: string, semanticId: string): string | undefined {
  if (kind === 'output') return 'Codex returns images here'
  if (kind === 'variations') return 'Keep exploring'
  if (kind === 'references') return 'You provide · Codex uses this'
  if (kind === 'controls') {
    return /brief|input|change|source/i.test(semanticId)
      ? 'You can edit'
      : 'You edit · Codex uses this'
  }
  return undefined
}
'''
new_cues = '''function collaborationCue(kind: string, semanticId: string): string | undefined {
  if (kind === 'output') return 'Codex returns here'
  if (kind === 'variations') return 'Keep exploring'
  if (kind === 'references') return 'You provide'
  if (kind === 'controls') {
    return /brief|input|change|source/i.test(semanticId)
      ? 'You edit'
      : 'Codex uses this'
  }
  return undefined
}
'''
panel = replace_once(panel, old_cues, new_cues, "collaboration cues")
panel_path.write_text(panel, encoding="utf-8")

styles = styles_path.read_text(encoding="utf-8")
styles = replace_once(
    styles,
    "  font-size: 8px !important;\n  font-weight: 620 !important;",
    "  font-size: 10px !important;\n  font-weight: 620 !important;",
    "collaboration cue font size",
)
styles_path.write_text(styles, encoding="utf-8")

e2e = e2e_path.read_text(encoding="utf-8")
e2e = replace_once(
    e2e,
    "  await expect(page.locator('.pc-panel--output .pc-panel__collaboration-cue')).toHaveText('Codex returns images here')",
    "  await expect(page.locator('.pc-panel--output .pc-panel__collaboration-cue')).toHaveText('Codex returns here')",
    "result cue assertion",
)
e2e = replace_once(
    e2e,
    "  await expect(page.getByLabel('Request for ChatGPT')).toHaveValue(/Do not generate an image yet/)",
    "  await expect(page.getByLabel('Message for Codex')).toHaveValue(/Do not generate an image yet/)",
    "shape-help request label",
)
e2e = replace_once(
    e2e,
    "  await expect(page.getByRole('heading', { name: 'Codex will use' })).toBeVisible()\n  await expect(page.getByText('Nothing is locked.",
    "  const preview = page.locator('.pc-codex-preview')\n  await expect(preview.getByText('A quiet observatory beneath a vivid desert night sky')).toBeVisible()\n  await expect(preview.getByText('cinematic · wide-shot')).toBeVisible()\n  await expect(page.getByText('Nothing is locked.",
    "generation preview assertions",
)
e2e_path.write_text(e2e, encoding="utf-8")

print("Finalized collaboration preview and compact canvas ownership cues.")
