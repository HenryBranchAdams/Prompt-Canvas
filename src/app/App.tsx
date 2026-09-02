import { Tldraw, type Editor } from 'tldraw'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  ActivityIcon,
  CloseIcon,
  CopyIcon,
  DuplicateIcon,
  LayersIcon,
  LibraryIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  SparkIcon,
} from './icons'
import { loadTldrawLicenseKey } from './runtime-license'
import { PromptCanvasRuntime, type RuntimeSnapshot } from './runtime'
import { promptCanvasShapeUtils, PROMPT_CANVAS_PANEL_TYPE } from '../shapes'
import type { PromptCanvasPanelShape } from '../shapes'
import { createPromptCanvasWebMcpTools } from '../webmcp/tools'
import { registerPromptCanvasTools } from '../webmcp/registration'
import type { GenerationContext, GenerationOperation } from '../workspaces/types'
import { webmcpCatalog } from '../generated/webmcpCatalog'

const runtime = new PromptCanvasRuntime()

const subscribeRuntime = (listener: () => void) => runtime.subscribe(listener)
const readRuntime = () => runtime.getSnapshot()

function useRuntimeSnapshot(): RuntimeSnapshot {
  return useSyncExternalStore(subscribeRuntime, readRuntime, readRuntime)
}

type InspectorTab = 'layers' | 'activity' | 'host'

type TldrawLicenseState =
  | { status: 'loading' }
  | { status: 'ready'; key?: string }
  | { status: 'error'; message: string }

const bundledTldrawLicenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY?.trim()

type TemplateSummary = {
  id: string
  title: string
  description: string
  category: string
  family: string
  operations: GenerationOperation[]
  capabilities: string[]
  featured: boolean
  version: number
  source?: { creator?: string; title?: string; url?: string | null; promptUsage?: string }
}

function connectionLabel(snapshot: RuntimeSnapshot): string {
  const { connection } = snapshot
  if (!connection.checked) return 'Finding WebMCP host'
  if (!connection.available) return 'Open inside Codex for WebMCP'
  if (connection.failed > 0) return `${connection.registered} tools · ${connection.failed} failed`
  return `${connection.registered} WebMCP tools connected`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function panelShapes(): PromptCanvasPanelShape[] {
  try {
    return runtime
      .getEditor()
      .getCurrentPageShapes()
      .filter((shape): shape is PromptCanvasPanelShape => shape.type === PROMPT_CANVAS_PANEL_TYPE)
      .sort((a, b) => a.y - b.y || a.x - b.x)
  } catch {
    return []
  }
}

function trapDialogTab(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

function TemplatePreview({ item }: { item: TemplateSummary }) {
  return (
    <div className="pc-template-card__preview" aria-hidden="true">
      {item.featured ? <small>Featured</small> : null}
      <div className={`pc-template-art is-${item.family}`}>
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}

function TemplateLibrary({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (templateId: string) => Promise<void>
}) {
  const snapshot = useRuntimeSnapshot()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState<string | undefined>(undefined)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  const all = snapshot.initialized
    ? ((runtime.listTemplates({ limit: 100 }).templates ?? []) as unknown as TemplateSummary[])
    : []
  const categories = [...new Set(all.map((item) => item.category))].sort((a, b) =>
    a.localeCompare(b),
  )
  const items = snapshot.initialized
    ? ((runtime.listTemplates({
        query,
        ...(category ? { categories: [category] } : {}),
        limit: 100,
      }).templates ?? []) as unknown as TemplateSummary[])
    : []

  const create = async (templateId: string) => {
    setCreating(templateId)
    try {
      await onCreate(templateId)
    } finally {
      setCreating(undefined)
    }
  }

  return (
    <aside className="pc-library is-open" aria-label="Prompt workspace library">
      <header>
        <div>
          <span className="pc-eyebrow">Starter pack and saved templates</span>
          <h2>Prompt workspace library</h2>
        </div>
        <button className="pc-icon-button" type="button" onClick={onClose} aria-label="Close library">
          <CloseIcon />
        </button>
      </header>
      <div className="pc-library__tools">
        <label className="pc-search-field">
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search by style, task, capability, or creator"
            aria-label="Search templates"
          />
        </label>
        <select value={category} onChange={(event) => setCategory(event.currentTarget.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((value) => (
            <option value={value} key={value}>
              {value.replace(/-/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <div className="pc-library__count">
        {items.length} compatible template{items.length === 1 ? '' : 's'} · Codex generates the images
      </div>
      <div className="pc-library__grid">
        {items.map((item) => (
          <article className="pc-template-card" key={`${item.id}@${item.version}`}>
            <TemplatePreview item={item} />
            <div className="pc-template-card__body">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="pc-template-card__meta">
                <span>{item.family.replace(/-/g, ' ')}</span>
                <span>{item.operations.join(' · ')}</span>
              </div>
              <button
                type="button"
                disabled={Boolean(creating)}
                onClick={() => void create(item.id)}
              >
                <PlusIcon />
                {creating === item.id ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}

function LayersInspector({ shapes }: { shapes: PromptCanvasPanelShape[] }) {
  return (
    <div className="pc-inspector__content">
      <header>
        <div>
          <span className="pc-eyebrow">Current tldraw page</span>
          <h3>Workspace layers</h3>
        </div>
        <small>{shapes.length}</small>
      </header>
      <div className="pc-layer-list">
        {shapes.map((shape) => (
          <button
            type="button"
            key={shape.id}
            title="Double-click to edit this panel"
            aria-label={`${shape.props.title}. Double-click to edit this panel.`}
            onClick={() => {
              const editor = runtime.getEditor()
              editor.select(shape.id)
              editor.zoomToSelection({ animation: { duration: 160 } })
            }}
            onDoubleClick={() => {
              const editor = runtime.getEditor()
              editor.select(shape.id)
              editor.zoomToSelection({ animation: { duration: 160 } })
              editor.setEditingShape(shape.id)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const editor = runtime.getEditor()
              editor.select(shape.id)
              editor.setEditingShape(shape.id)
            }}
          >
            <span className={`pc-layer-icon is-${shape.props.kind}`} />
            <span>
              <strong>{shape.props.title}</strong>
              <small>{shape.props.semanticId}</small>
            </span>
            <em>{shape.props.kind}</em>
          </button>
        ))}
      </div>
    </div>
  )
}

function ActivityInspector({ snapshot }: { snapshot: RuntimeSnapshot }) {
  return (
    <div className="pc-inspector__content">
      <header>
        <div>
          <span className="pc-eyebrow">Local audit trail</span>
          <h3>Activity</h3>
        </div>
        <small>{snapshot.activity.length}</small>
      </header>
      <div className="pc-activity-list">
        {snapshot.activity.length === 0 ? <p className="pc-empty-copy">No activity yet.</p> : null}
        {snapshot.activity.map((entry) => (
          <article className={`is-${entry.status}`} key={entry.id}>
            <span />
            <div>
              <strong>{entry.summary}</strong>
              <small>{formatTime(entry.at)} · {entry.source.replace(/-/g, ' ')}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function HostInspector({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const connected = snapshot.connection.available && snapshot.connection.failed === 0
  return (
    <div className="pc-inspector__content">
      <header>
        <div>
          <span className="pc-eyebrow">Codex app bridge</span>
          <h3>WebMCP host</h3>
        </div>
        <small>{snapshot.connection.registered}</small>
      </header>
      <div className="pc-host-panel">
        <div className={connected ? 'pc-host-status is-connected' : 'pc-host-status'}>
          <span />
          {connectionLabel(snapshot)}
        </div>
        <dl>
          <div><dt>Image generation</dt><dd>Codex host</dd></div>
          <div><dt>Registered tools</dt><dd>{snapshot.connection.registered} / {webmcpCatalog.tools.length}</dd></div>
          <div><dt>Asset delivery</dt><dd>WebMCP import</dd></div>
          <div><dt>Page-accepted transports</dt><dd>{snapshot.verifiedAssetTransports.join(', ') || 'data URL self-test pending'}</dd></div>
          <div><dt>Persistence</dt><dd>Device local</dd></div>
        </dl>
        <p>
          Prompt Canvas does not call an image API. These transports passed the page's bounded parser self-test;
          a release host is qualified separately when Codex returns an actual generated image.
        </p>
        {snapshot.connection.errors.length ? <pre>{snapshot.connection.errors.join('\n')}</pre> : null}
      </div>
    </div>
  )
}

function Inspector({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const [tab, setTab] = useState<InspectorTab>('layers')
  const shapes = panelShapes()
  return (
    <aside className="pc-inspector" aria-label="Workspace inspector">
      <nav aria-label="Inspector panels">
        <button className={tab === 'layers' ? 'is-active' : ''} type="button" onClick={() => setTab('layers')}>
          <LayersIcon /> Layers
        </button>
        <button className={tab === 'activity' ? 'is-active' : ''} type="button" onClick={() => setTab('activity')}>
          <ActivityIcon /> Activity
        </button>
        <button className={tab === 'host' ? 'is-active' : ''} type="button" onClick={() => setTab('host')}>
          <SparkIcon /> Host
        </button>
      </nav>
      {tab === 'layers' ? <LayersInspector shapes={shapes} /> : null}
      {tab === 'activity' ? <ActivityInspector snapshot={snapshot} /> : null}
      {tab === 'host' ? <HostInspector snapshot={snapshot} /> : null}
    </aside>
  )
}

function BlankWorkspaceDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (title: string, prompt: string) => Promise<void>
}) {
  const [title, setTitle] = useState('Untitled image workspace')
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    titleRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      trapDialogTab(event, dialogRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="pc-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="pc-dialog" role="dialog" aria-modal="true" aria-labelledby="blank-workspace-title">
        <header>
          <div>
            <span className="pc-eyebrow">Open-ended by default</span>
            <h2 id="blank-workspace-title">Create a prompt workspace</h2>
          </div>
          <button className="pc-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></button>
        </header>
        <p>
          Begin with a freeform prompt and a small set of useful controls. Codex can add or reshape
          the workspace later through WebMCP without forcing it into a rigid template.
        </p>
        <label>
          Workspace title
          <input ref={titleRef} value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={120} />
        </label>
        <label>
          Starting prompt
          <small>Optional. You can write directly on the canvas after creation.</small>
          <textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} />
        </label>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            className="pc-primary-button"
            type="button"
            disabled={submitting || title.trim().length < 2}
            onClick={() => {
              setSubmitting(true)
              void onCreate(title.trim(), prompt).finally(() => setSubmitting(false))
            }}
          >
            <PlusIcon /> {submitting ? 'Creating…' : 'Create workspace'}
          </button>
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
  const [copied, setCopied] = useState(false)
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
    await navigator.clipboard.writeText(context.resolvedPrompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1300)
  }
  return (
    <div className="pc-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} className="pc-dialog pc-dialog--generation" role="dialog" aria-modal="true" aria-labelledby="generation-context-title">
        <header>
          <div>
            <span className="pc-eyebrow">Prepared for Codex image generation</span>
            <h2 id="generation-context-title">Workspace context is ready</h2>
          </div>
          <button ref={closeRef} className="pc-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></button>
        </header>
        <p>
          Continue in the Codex app chat. Codex can read this exact context through WebMCP, generate
          the image itself, and write the result back into the target canvas output.
        </p>
        <div className="pc-context-summary">
          <div><span>Operation</span><strong>{context.operation}</strong></div>
          <div><span>Generation rev</span><strong>{context.generationRevision}</strong></div>
          <div><span>Target</span><strong>{context.targetOutputId}</strong></div>
          <div><span>Aspect ratio</span><strong>{context.outputRequirements.aspectRatio}</strong></div>
        </div>
        <details open>
          <summary>Resolved prompt sent to Codex</summary>
          <pre>{context.resolvedPrompt}</pre>
        </details>
        {context.negativePrompt ? (
          <details>
            <summary>Negative prompt</summary>
            <pre>{context.negativePrompt}</pre>
          </details>
        ) : null}
        <details>
          <summary>Host instruction and request identity</summary>
          <pre>{context.hostInstruction}\n\nRequest: {context.requestId}</pre>
        </details>
        <footer>
          <button type="button" onClick={() => void copy()}><CopyIcon /> {copied ? 'Copied' : 'Copy prompt'}</button>
          <button className="pc-primary-button" type="button" onClick={onClose}>Close and continue in Codex</button>
        </footer>
      </section>
    </div>
  )
}

export default function App() {
  const snapshot = useRuntimeSnapshot()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [blankOpen, setBlankOpen] = useState(false)
  const libraryButtonRef = useRef<HTMLButtonElement>(null)
  const blankButtonRef = useRef<HTMLButtonElement>(null)
  const prepareButtonRef = useRef<HTMLButtonElement>(null)
  const [tldrawLicense, setTldrawLicense] = useState<TldrawLicenseState>(() => (
    bundledTldrawLicenseKey
      ? { status: 'ready', key: bundledTldrawLicenseKey }
      : { status: 'loading' }
  ))

  const attachEditor = useCallback((editor: Editor) => {
    editor.updateInstanceState({ isGridMode: true })
    void runtime.attachEditor(editor).catch((error) => runtime.setLastError(error))
  }, [])

  useEffect(() => {
    if (!snapshot.initialized) return
    const tools = createPromptCanvasWebMcpTools(runtime)
    return registerPromptCanvasTools({
      tools,
      onConnection: (connection) => runtime.setConnectionState(connection),
    })
  }, [snapshot.initialized])

  useEffect(() => {
    if (tldrawLicense.status !== 'loading') return
    const controller = new AbortController()
    void loadTldrawLicenseKey({
      bundledKey: bundledTldrawLicenseKey,
      development: import.meta.env.DEV,
      signal: controller.signal,
    }).then(
      (key) => setTldrawLicense({ status: 'ready', ...(key ? { key } : {}) }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setTldrawLicense({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return () => controller.abort()
  }, [tldrawLicense.status])

  useEffect(() => () => runtime.dispose(), [])

  const active = snapshot.activeWorkspace
  const connected = snapshot.connection.available && snapshot.connection.failed === 0

  const run = async (task: () => Promise<unknown> | unknown) => {
    try {
      await task()
    } catch (error) {
      runtime.setLastError(error)
    }
  }

  const prepareGeneration = () => {
    if (!active) return
    void run(() => {
      runtime.prepareGenerationFromUi({ workspaceId: active.workspaceId })
    })
  }

  const closeLibrary = useCallback(() => {
    setLibraryOpen(false)
    window.requestAnimationFrame(() => libraryButtonRef.current?.focus())
  }, [])

  const closeBlankDialog = useCallback(() => {
    setBlankOpen(false)
    window.requestAnimationFrame(() => blankButtonRef.current?.focus())
  }, [])

  const closeGenerationDialog = useCallback(() => {
    runtime.clearPreparedContext()
    window.requestAnimationFrame(() => prepareButtonRef.current?.focus())
  }, [])

  return (
    <main className="pc-app">
      <header className="pc-topbar">
        <div className="pc-brand">
          <span className="pc-brand-mark"><SparkIcon /></span>
          <div><strong>Prompt Canvas</strong><small>Codex image workspaces</small></div>
        </div>
        <label className="pc-workspace-switcher">
          <select
            value={active?.workspaceId ?? ''}
            disabled={!snapshot.initialized}
            onChange={(event) => runtime.setActiveWorkspace(event.currentTarget.value)}
            aria-label="Active workspace"
          >
            {!active ? <option value="">Loading workspaces…</option> : null}
            {snapshot.workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
            ))}
          </select>
          <span>{active ? `r${active.documentRevision}` : '—'}</span>
        </label>
        <div className="pc-topbar__actions">
          <span className={connected ? 'pc-host-status is-connected' : 'pc-host-status'} title={snapshot.connection.errors.join('\n')}>
            <span /> {connectionLabel(snapshot)}
          </span>
          <button ref={libraryButtonRef} type="button" onClick={() => setLibraryOpen(true)}><LibraryIcon /><span>Library</span></button>
          <button
            type="button"
            disabled={!active}
            onClick={() => active && void run(() => runtime.duplicateWorkspace(active.workspaceId))}
          ><DuplicateIcon /><span>Duplicate</span></button>
          <button
            type="button"
            disabled={!active}
            onClick={() => active && void run(() => runtime.saveTemplate({
              source: { kind: 'workspace', workspaceId: active.workspaceId },
              title: `${active.title} copy`,
              mode: 'fork',
            }))}
          ><SaveIcon /><span>Save template</span></button>
          <button ref={blankButtonRef} type="button" onClick={() => setBlankOpen(true)}><PlusIcon /><span>Blank</span></button>
          <button ref={prepareButtonRef} className="pc-primary-button" type="button" disabled={!active} onClick={prepareGeneration}>
            <SparkIcon /><span>Prepare for Codex</span>
          </button>
        </div>
      </header>

      <section className="pc-main">
        <div className="pc-canvas-shell" aria-label="Prompt workspace canvas">
          {tldrawLicense.status === 'ready' ? (
            <Tldraw
              persistenceKey="prompt-canvas-document-v1"
              shapeUtils={promptCanvasShapeUtils}
              options={{ maxPages: 100 }}
              onMount={attachEditor}
              colorScheme="light"
              licenseKey={tldrawLicense.key}
              autoFocus
            />
          ) : null}
          {tldrawLicense.status === 'error' ? (
            <div className="pc-loading" role="alert">
              <SparkIcon />
              <strong>Prompt Canvas could not open</strong>
              <span>{tldrawLicense.message}</span>
            </div>
          ) : !snapshot.initialized ? (
            <div className="pc-loading" role="status" aria-live="polite"><SparkIcon /><strong>Opening Prompt Canvas</strong><span>Loading the local library and travel poster workspace…</span></div>
          ) : null}
        </div>
        <Inspector snapshot={snapshot} />
      </section>

      <footer className="pc-statusbar">
        <span><i className={connected ? 'is-live' : ''} /> {connected ? 'Codex can read and write this workspace through WebMCP' : 'Canvas works locally; WebMCP appears when opened in the Codex desktop host'}</span>
        <span>{active ? `${active.generationState.replace(/-/g, ' ')} · generation r${active.generationRevision}` : 'No active workspace'}</span>
      </footer>

      <TemplateLibrary
        open={libraryOpen}
        onClose={closeLibrary}
        onCreate={async (templateId) => {
          await run(() => runtime.createWorkspace({ kind: 'template', templateId }, 'new-page', true))
          closeLibrary()
        }}
      />

      <BlankWorkspaceDialog
        open={blankOpen}
        onClose={closeBlankDialog}
        onCreate={async (title, prompt) => {
          await run(() => runtime.createWorkspace({ kind: 'blank', title, prompt }, 'new-page', true))
          closeBlankDialog()
        }}
      />

      {snapshot.preparedContext ? (
        <GenerationDialog
          context={snapshot.preparedContext}
          onClose={closeGenerationDialog}
        />
      ) : null}

      {snapshot.lastError ? (
        <div className="pc-toast" role="alert">
          <strong>Prompt Canvas could not complete that action</strong>
          <span>{snapshot.lastError}</span>
          <button type="button" onClick={() => runtime.setLastError('')}>Dismiss</button>
        </div>
      ) : null}
    </main>
  )
}
