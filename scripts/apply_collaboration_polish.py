from __future__ import annotations

from pathlib import Path
import re


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
app = replace_once(
    app,
    "  useSyncExternalStore,\n} from 'react'",
    "  useSyncExternalStore,\n  type ReactNode,\n} from 'react'",
    "React type import",
)
app = replace_once(
    app,
    "<p>Choose a recipe to get started. Each one guides you step by step.</p>",
    "<p>Build the brief here; Codex turns it into images and returns them to your canvas.</p>",
    "recipe-library collaboration copy",
)
app = replace_once(
    app,
    "<div><strong>Prompt Canvas</strong><small>Creative image projects</small></div>",
    "<div><strong>Prompt Canvas</strong><small>You direct. Codex creates.</small></div>",
    "brand collaboration copy",
)

new_dialogs = r'''type RequestPreviewItem = {
  label: string
  value: string
}

function humanizePreviewKey(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactPreviewValue(value: unknown): string | undefined {
  let rendered: string | undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    rendered = String(value)
  } else if (Array.isArray(value)) {
    rendered = value.map((item) => compactPreviewValue(item)).filter(Boolean).join(', ')
  }
  if (!rendered?.trim()) return undefined
  return rendered.length > 110 ? `${rendered.slice(0, 107)}…` : rendered
}

function generationRequest(context: GenerationContext): string {
  switch (context.operation) {
    case 'edit':
      return 'Apply the prepared change to my current Prompt Canvas result and return the new image to the Result card.'
    case 'variation':
      return 'Create the prepared variations from my current Prompt Canvas result and return them to the Variations card.'
    case 'upscale':
      return 'Upscale the selected Prompt Canvas result and return it to the canvas.'
    case 'generate':
    default:
      return 'Generate an image from my current Prompt Canvas project and return it to the Result card. Use the canvas’s latest live state.'
  }
}

function generationDialogTitle(context: GenerationContext): string {
  switch (context.operation) {
    case 'edit':
      return 'Ask Codex to change this image'
    case 'variation':
      return 'Ask Codex to create variations'
    case 'upscale':
      return 'Ask Codex to upscale this image'
    case 'generate':
    default:
      return 'Ask Codex to create this image'
  }
}

function generationPreview(context: GenerationContext): RequestPreviewItem[] {
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

function CodexRequestDialog({
  eyebrow,
  title,
  description,
  request,
  preview,
  note,
  technical,
  onClose,
}: {
  eyebrow: string
  title: string
  description: string
  request: string
  preview?: RequestPreviewItem[]
  note: string
  technical?: ReactNode
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      trapDialogTab(event, dialogRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(request)
      setCopied(true)
      setCopyError(false)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div className="pc-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="pc-dialog pc-dialog--generation pc-dialog--codex-request" role="dialog" aria-modal="true" aria-labelledby="codex-request-title">
        <header>
          <div>
            <span className="pc-eyebrow">{eyebrow}</span>
            <h2 id="codex-request-title">{title}</h2>
          </div>
          <button ref={closeRef} className="pc-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></button>
        </header>
        <p>{description}</p>
        {preview?.length ? (
          <section className="pc-codex-preview" aria-labelledby="codex-preview-title">
            <h3 id="codex-preview-title">Codex will use</h3>
            <dl>
              {preview.map((item) => (
                <div key={`${item.label}:${item.value}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        <label className="pc-codex-request">
          Request for ChatGPT
          <textarea
            readOnly
            rows={3}
            value={request}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <p className="pc-codex-note">{note}</p>
        {technical}
        {copyError ? <p className="pc-copy-error" role="alert">Clipboard access is unavailable. Select the request above and copy it manually.</p> : null}
        <footer>
          <button className="pc-primary-button" type="button" onClick={() => void copy()}><CopyIcon /> {copied ? 'Copied' : 'Copy request'}</button>
          <button type="button" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  )
}

function GenerationDialog({
  context,
  onClose,
}: {
  context: GenerationContext
  onClose: () => void
}) {
  return (
    <CodexRequestDialog
      eyebrow="Prepared for Codex"
      title={generationDialogTitle(context)}
      description="Prompt Canvas prepared a revision-bound request from the live canvas. Copy it into the ChatGPT conversation beside this Site; Codex will use the current state and return the image to the right card."
      request={generationRequest(context)}
      preview={generationPreview(context)}
      note="Nothing is locked. You can keep editing the brief, change one thing, or make variations at any time."
      technical={(
        <details className="pc-technical-details">
          <summary>View technical details</summary>
          <div className="pc-context-summary">
            <div><span>Operation</span><strong>{context.operation}</strong></div>
            <div><span>Generation revision</span><strong>{context.generationRevision}</strong></div>
            <div><span>Target output</span><strong>{context.targetOutputId}</strong></div>
            <div><span>Aspect ratio</span><strong>{context.outputRequirements.aspectRatio}</strong></div>
          </div>
          <h3>Resolved prompt</h3>
          <pre>{context.resolvedPrompt}</pre>
          {context.negativePrompt ? <><h3>Avoid</h3><pre>{context.negativePrompt}</pre></> : null}
          <h3>Request identity</h3>
          <pre>{context.hostInstruction}\n\nRequest: {context.requestId}</pre>
        </details>
      )}
      onClose={onClose}
    />
  )
}

function ShapeHelpDialog({
  projectTitle,
  onClose,
}: {
  projectTitle: string
  onClose: () => void
}) {
  return (
    <CodexRequestDialog
      eyebrow="Shape it together"
      title="Ask Codex to help with the brief"
      description="Codex can inspect the live project, ask a small number of useful questions, and update the brief or direction on this canvas. It will not generate an image until you ask."
      request="Help me shape the current Prompt Canvas project. Review the live brief and direction, ask at most two focused questions if needed, then update the canvas with a strong starting point. Do not generate an image yet."
      preview={[
        { label: 'Project', value: projectTitle },
        { label: 'Codex can', value: 'Inspect and update the live canvas' },
      ]}
      note="You stay in control: review or edit every suggestion directly on the canvas."
      onClose={onClose}
    />
  )
}

export default function App() {'''

app, dialog_count = re.subn(
    r"function GenerationDialog\(\{.*?\n\}\n\nexport default function App\(\) \{",
    new_dialogs,
    app,
    count=1,
    flags=re.DOTALL,
)
if dialog_count != 1:
    raise RuntimeError(f"Expected to replace one GenerationDialog block, replaced {dialog_count}.")

app = replace_once(
    app,
    "  const [inspectorOpen, setInspectorOpen] = useState(false)\n",
    "  const [inspectorOpen, setInspectorOpen] = useState(false)\n  const [shapeHelpOpen, setShapeHelpOpen] = useState(false)\n",
    "shape-help state",
)
app = replace_once(
    app,
    "  const prepareButtonRef = useRef<HTMLButtonElement>(null)\n",
    "  const prepareButtonRef = useRef<HTMLButtonElement>(null)\n  const shapeHelpButtonRef = useRef<HTMLButtonElement>(null)\n",
    "shape-help ref",
)
app = replace_once(
    app,
    "  const closeGenerationDialog = useCallback(() => {\n    runtime.clearPreparedContext()\n    window.requestAnimationFrame(() => prepareButtonRef.current?.focus())\n  }, [])\n",
    "  const closeGenerationDialog = useCallback(() => {\n    runtime.clearPreparedContext()\n    window.requestAnimationFrame(() => prepareButtonRef.current?.focus())\n  }, [])\n\n  const closeShapeHelpDialog = useCallback(() => {\n    setShapeHelpOpen(false)\n    window.requestAnimationFrame(() => shapeHelpButtonRef.current?.focus())\n  }, [])\n",
    "shape-help close callback",
)
app = replace_once(
    app,
    "          <details className=\"pc-more-menu\">",
    "          {active ? (\n            <button\n              ref={shapeHelpButtonRef}\n              className=\"pc-collaboration-button\"\n              type=\"button\"\n              aria-label=\"Help me shape it\"\n              onClick={() => setShapeHelpOpen(true)}\n            >\n              <AgentIcon /><span>Help me shape it</span>\n            </button>\n          ) : null}\n          <details className=\"pc-more-menu\">",
    "shape-help topbar action",
)
app = app.replace("<PlayIcon /><span>Generate with Codex</span>", "<PlayIcon /><span>Ask Codex to generate</span>")
app = replace_once(
    app,
    "      {snapshot.preparedContext ? (\n        <GenerationDialog",
    "      {shapeHelpOpen && active ? (\n        <ShapeHelpDialog\n          projectTitle={active.title}\n          onClose={closeShapeHelpDialog}\n        />\n      ) : null}\n\n      {snapshot.preparedContext ? (\n        <GenerationDialog",
    "shape-help dialog render",
)
app_path.write_text(app, encoding="utf-8")

panel = panel_path.read_text(encoding="utf-8")
panel = replace_once(
    panel,
    "import { EditIcon, ImageIcon, PlayIcon, UpscaleIcon } from '../app/icons'",
    "import { EditIcon, ImageIcon, PlayIcon, UpscaleIcon, VariationsIcon } from '../app/icons'",
    "Variations icon import",
)
panel = panel.replace("Generate with Codex", "Ask Codex to generate")
panel = replace_once(
    panel,
    "                Vary\n              </button>",
    "                <VariationsIcon />\n                Vary\n              </button>",
    "Vary icon",
)

cue_helper = r'''function collaborationCue(kind: string, semanticId: string): string | undefined {
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
panel = replace_once(
    panel,
    "function PromptCanvasPanel(props: { shape: PromptCanvasPanelShape; editor: Editor }) {",
    cue_helper + "function PromptCanvasPanel(props: { shape: PromptCanvasPanelShape; editor: Editor }) {",
    "collaboration cue helper",
)
panel = replace_once(
    panel,
    "      <header className=\"pc-panel__header\">\n        <span>{shape.props.title}</span>\n        <span className=\"pc-panel__grip\" aria-hidden=\"true\" />\n      </header>",
    "      <header className=\"pc-panel__header\">\n        <span>{shape.props.title}</span>\n        {collaborationCue(shape.props.kind, shape.props.semanticId) ? (\n          <span className=\"pc-panel__collaboration-cue\">\n            {collaborationCue(shape.props.kind, shape.props.semanticId)}\n          </span>\n        ) : null}\n        <span className=\"pc-panel__grip\" aria-hidden=\"true\" />\n      </header>",
    "panel collaboration cue",
)
panel = replace_once(
    panel,
    "        ) : null}\n      </div>\n    )\n  }\n\n  return <VariationsPanel",
    "        ) : null}\n        {props.editing ? (\n          <p className=\"pc-output-reassurance\">\n            Keep refining: edit the brief, change one thing, or make variations at any time.\n          </p>\n        ) : null}\n      </div>\n    )\n  }\n\n  return <VariationsPanel",
    "result reassurance",
)
panel_path.write_text(panel, encoding="utf-8")

styles = styles_path.read_text(encoding="utf-8")
marker = "/* Codex collaboration polish */"
if marker in styles:
    raise RuntimeError("Collaboration polish styles already exist.")
styles += r'''

/* Codex collaboration polish */
.pc-brand {
  min-width: 208px;
}

.pc-brand small {
  color: #6c7780;
  font-size: 10.5px;
  font-weight: 520;
}

.pc-collaboration-button {
  color: #4f5d68 !important;
  background: #f8fafb !important;
}

.pc-collaboration-button:hover:not(:disabled) {
  color: var(--pc-ink) !important;
  background: #f2f5f6 !important;
}

.pc-library > header p {
  max-width: 680px;
  color: #596671;
  font-size: 14px;
  line-height: 1.55;
}

.pc-dialog--codex-request {
  width: min(590px, calc(100vw - 32px));
}

.pc-codex-preview {
  display: grid;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--pc-border);
  border-radius: 11px;
  background: #f8faf9;
}

.pc-codex-preview h3 {
  margin: 0;
  color: #4c5963;
  font-size: 11px;
  font-weight: 760;
}

.pc-codex-preview dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.pc-codex-preview dl > div {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid #e3e8e8;
  border-radius: 8px;
  background: #fff;
}

.pc-codex-preview dt {
  color: var(--pc-faint);
  font-size: 9px;
  font-weight: 720;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.pc-codex-preview dd {
  min-width: 0;
  margin: 0;
  color: #29353e;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.pc-codex-request {
  display: grid;
  gap: 6px;
  color: #4f5c66;
  font-size: 10px;
  font-weight: 700;
}

.pc-codex-request textarea {
  width: 100%;
  min-height: 76px;
  resize: none;
  padding: 10px 11px;
  border: 1px solid #d7dfe1;
  border-radius: 9px;
  background: #fff;
  color: #25313a;
  font-size: 12px;
  font-weight: 520;
  line-height: 1.5;
}

.pc-codex-note {
  margin: 0;
  padding: 10px 11px;
  border-radius: 9px;
  background: var(--pc-blue-soft);
  color: #315385;
  font-size: 10px;
  line-height: 1.5;
}

.pc-copy-error {
  margin: 0;
  color: #9a4e41;
  font-size: 10px;
}

.pc-panel__header > span:first-child {
  min-width: 0;
}

.pc-panel__collaboration-cue {
  margin-left: auto;
  flex: 0 0 auto;
  color: #84909a;
  font-size: 8px !important;
  font-weight: 620 !important;
  letter-spacing: .01em;
}

.pc-panel__grip {
  margin-left: 1px;
}

.pc-output-reassurance {
  margin: 0;
  padding: 0 12px 10px;
  color: #78838c;
  font-size: 8.5px;
  line-height: 1.45;
  text-align: center;
}

@media (max-width: 1120px) {
  .pc-collaboration-button span {
    display: none;
  }

  .pc-collaboration-button {
    width: 34px;
    padding: 0 !important;
  }
}

@media (max-width: 760px) {
  .pc-codex-preview dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .pc-panel__collaboration-cue {
    display: none;
  }
}
'''
styles_path.write_text(styles, encoding="utf-8")

# Keep browser assertions aligned with the honest CTA. Add one focused UX test.
e2e = e2e_path.read_text(encoding="utf-8")
e2e = e2e.replace("Generate with Codex", "Ask Codex to generate")
if "collaboration model is explicit before generation" not in e2e:
    e2e += r'''

test('collaboration model is explicit before generation', async ({ page }) => {
  await installMockWebMcp(page)
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })

  await expect(page.getByText('Build the brief here; Codex turns it into images and returns them to your canvas.')).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).first().click()

  await expect(page.getByText('You direct. Codex creates.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Help me shape it' })).toBeVisible()
  await expect(page.locator('.pc-panel--controls .pc-panel__collaboration-cue').first()).toContainText('You')
  await expect(page.locator('.pc-panel--output .pc-panel__collaboration-cue')).toHaveText('Codex returns images here')

  await page.getByRole('button', { name: 'Help me shape it' }).click()
  await expect(page.getByRole('heading', { name: 'Ask Codex to help with the brief' })).toBeVisible()
  await expect(page.getByLabel('Request for ChatGPT')).toHaveValue(/Do not generate an image yet/)
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Ask Codex to generate' }).click()
  await expect(page.getByRole('heading', { name: 'Ask Codex to create this image' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Codex will use' })).toBeVisible()
  await expect(page.getByText('Nothing is locked. You can keep editing the brief, change one thing, or make variations at any time.')).toBeVisible()
})
'''
e2e_path.write_text(e2e, encoding="utf-8")

print("Applied collaboration framing, handoff preview, card cues, and tests.")
