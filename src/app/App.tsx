import { Tldraw, type Editor, type TLComponents } from 'tldraw'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  ActivityIcon,
  AgentIcon,
  AppMarkIcon,
  CloseIcon,
  CopyIcon,
  DuplicateIcon,
  LayersIcon,
  LibraryIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  ImageIcon,
  PlayIcon,
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

const tldrawComponents = {
  StylePanel: null,
  PageMenu: null,
} satisfies TLComponents

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
  referenceCount: number
  controlCount: number
  source?: { creator?: string; title?: string; url?: string | null; promptUsage?: string }
  sourceKind?: 'official' | 'local' | 'bundled'
  hash?: string
  userPromise?: string
  requiredInputs?: string[]
  preserves?: string[]
  badges?: string[]
  thumbnail?: { src: string; alt: string }
}

type RecipeDiscovery = {
  collection?: string
  userPromise?: string
  inputSummary?: string[]
  badges?: string[]
  featuredRank?: number
  complexity?: string
}

function connectionLabel(snapshot: RuntimeSnapshot): string {
  const { connection } = snapshot
  if (!connection.checked) return 'Finding WebMCP host'
  if (!connection.available) return 'Open in ChatGPT desktop to work with the agent'
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

type WorkspaceOption = RuntimeSnapshot['workspaces'][number]

function workspaceOptionLabels(workspaces: WorkspaceOption[]): Map<string, string> {
  const titleCounts = new Map<string, number>()
  for (const workspace of workspaces) {
    titleCounts.set(workspace.title, (titleCounts.get(workspace.title) ?? 0) + 1)
  }

  const titleOccurrences = new Map<string, number>()
  return new Map(workspaces.map((workspace) => {
    const count = titleCounts.get(workspace.title) ?? 0
    const occurrence = (titleOccurrences.get(workspace.title) ?? 0) + 1
    titleOccurrences.set(workspace.title, occurrence)
    const label = count > 1 ? `${workspace.title} · ${occurrence}` : workspace.title
    return [workspace.workspaceId, label]
  }))
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

function recipeDetails(item: TemplateSummary): {
  discovery: RecipeDiscovery
  thumbnail?: { assetPath: string; alt: string }
} {
  if (item.sourceKind === 'local') {
    return {
      discovery: {
        ...(item.userPromise ? { userPromise: item.userPromise } : {}),
        ...(item.requiredInputs ? { inputSummary: item.requiredInputs } : {}),
        ...(item.badges ? { badges: item.badges } : {}),
      },
      ...(item.thumbnail ? { thumbnail: { assetPath: item.thumbnail.src, alt: item.thumbnail.alt } } : {}),
    }
  }
  const template = runtime.getTemplate(item.id, item.version)
  const raw = template['x-discovery']
  const discovery = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as RecipeDiscovery
    : {}
  return {
    discovery: {
      ...discovery,
      ...(item.userPromise ? { userPromise: item.userPromise } : {}),
      ...(item.requiredInputs ? { inputSummary: item.requiredInputs } : {}),
      ...(item.badges ? { badges: item.badges } : {}),
    },
    thumbnail: item.thumbnail ? { assetPath: item.thumbnail.src, alt: item.thumbnail.alt } : template.thumbnail,
  }
}

function TemplatePreview({ item }: { item: TemplateSummary }) {
  const { thumbnail } = recipeDetails(item)
  return (
    <div className="pc-template-card__preview" aria-hidden="true">
      {thumbnail ? <img src={thumbnail.assetPath} alt="" /> : <div className="pc-recipe-fallback"><ImageIcon /></div>}
    </div>
  )
}

function TemplateLibrary({
  open,
  dismissible,
  onClose,
  onCreate,
  onCreateBlank,
}: {
  open: boolean
  dismissible: boolean
  onClose: () => void
  onCreate: (item: TemplateSummary) => Promise<void>
  onCreateBlank: () => void
}) {
  const snapshot = useRuntimeSnapshot()
  const [query, setQuery] = useState('')
  const [showAllOfficial, setShowAllOfficial] = useState(false)
  const [creating, setCreating] = useState<string | undefined>(undefined)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismissible, onClose, open])

  if (!open) return null

  const items = snapshot.initialized
    ? ((runtime.listTemplates({
        query,
        limit: 100,
      }).templates ?? []) as unknown as TemplateSummary[])
    : []
  const official = items.filter((item) => item.sourceKind === 'official')
  const bundled = items.filter((item) => item.sourceKind === 'bundled')
  const local = items.filter((item) => item.sourceKind === 'local')
  const quick = official
    .filter((item) => {
      const discovery = recipeDetails(item).discovery
      return discovery.collection === 'start-fast' || discovery.complexity === 'quick'
    })
    .sort((a, b) => (recipeDetails(a).discovery.featuredRank ?? 999) - (recipeDetails(b).discovery.featuredRank ?? 999))
  const quickIds = new Set(quick.map((item) => item.id))
  const systems = official.filter((item) => !quickIds.has(item.id))
  const hasQuery = query.trim().length > 0
  const visibleSystems = hasQuery || showAllOfficial ? systems : systems.slice(0, 8)

  const create = async (item: TemplateSummary) => {
    setCreating(item.id)
    try {
      await onCreate(item)
    } finally {
      setCreating(undefined)
    }
  }

  return (
    <aside className="pc-library is-open" aria-label="Prompt Canvas recipes">
      <header>
        <div>
          <span className="pc-eyebrow">Prompt Canvas recipes</span>
          <h2>What would you like to make?</h2>
          <p>Choose a recipe to get started. Each one guides you step by step.</p>
        </div>
        {dismissible ? <button className="pc-icon-button" type="button" onClick={onClose} aria-label="Close recipes"><CloseIcon /></button> : null}
      </header>
      <div className="pc-library__tools">
        <label className="pc-search-field">
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Try “make this wider” or “keep my face”"
            aria-label="Search recipes"
          />
        </label>
      </div>
      <div className="pc-library__grid">
        {quick.map((item) => {
          const { discovery } = recipeDetails(item)
          return (
          <article className="pc-template-card" key={`${item.id}@${item.version}`}>
            <TemplatePreview item={item} />
            <div className="pc-template-card__body">
              <h3>{item.title}</h3>
              <p>{discovery.userPromise ?? item.description}</p>
              <div className="pc-template-card__meta">{(discovery.badges ?? []).slice(0, 2).map((badge) => <span key={badge}>{badge}</span>)}</div>
              <button
                type="button"
                disabled={Boolean(creating)}
                onClick={() => void create(item)}
              >
                <PlusIcon />
                {creating === item.id ? 'Starting…' : 'Start'}
              </button>
            </div>
          </article>
          )
        })}
        {!query ? (
          <article className="pc-template-card pc-template-card--blank">
            <div className="pc-template-card__preview"><div className="pc-recipe-fallback"><PlusIcon /></div></div>
            <div className="pc-template-card__body">
              <h3>Start with a blank canvas</h3>
              <p>Begin with an open prompt and shape the project your way.</p>
              <div className="pc-template-card__meta"><span>Completely open</span></div>
              <button type="button" onClick={onCreateBlank}><PlusIcon /> Start</button>
            </div>
          </article>
        ) : null}
      </div>
      {systems.length > 0 ? <section className="pc-creative-systems pc-official-systems">
        <div><span className="pc-eyebrow">Official recipes</span><h3>Explore more recipes</h3><p>Advanced and specialized starting points.</p></div>
        <div className="pc-system-list">{visibleSystems.map((item) => (
          <button key={`${item.id}@${item.version}`} type="button" disabled={Boolean(creating)} onClick={() => void create(item)}>
            <ImageIcon /><span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button>
        ))}</div>
        {!hasQuery ? (
          <button
            className="pc-library-disclosure"
            type="button"
            aria-expanded={showAllOfficial}
            onClick={() => setShowAllOfficial((value) => !value)}
          >
            {showAllOfficial ? 'Show fewer recipes' : `Browse all ${official.length} official recipes`}
          </button>
        ) : null}
      </section> : null}
      {bundled.length > 0 ? <section className="pc-creative-systems pc-bundled-systems">
        <div><span className="pc-eyebrow">Creative systems</span><h3>Advanced creative systems</h3><p>Flexible starting points for deeper workflows.</p></div>
        <div className="pc-system-list">{bundled.map((item) => (
          <button key={`${item.id}@${item.version}`} type="button" disabled={Boolean(creating)} onClick={() => void create(item)}>
            <ImageIcon /><span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button>
        ))}</div>
      </section> : null}
      {local.length > 0 ? <section className="pc-creative-systems pc-my-recipes">
        <div><span className="pc-eyebrow">My recipes</span><h3>Saved by you</h3><p>Saved in this browser on this device.</p></div>
        <div className="pc-system-list">{local.map((item) => (
          <button key={`local:${item.id}@${item.version}`} type="button" disabled={Boolean(creating)} onClick={() => void create(item)}>
            <ImageIcon /><span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button>
        ))}</div>
      </section> : null}
      {items.length === 0 ? <p className="pc-empty-copy">No recipes match that request.</p> : null}
    </aside>
  )
}

function LayersInspector({ shapes }: { shapes: PromptCanvasPanelShape[] }) {
  return (
    <div className="pc-inspector__content">
      <header>
        <div>
          <span className="pc-eyebrow">Current tldraw page</span>
          <h3>Project layers</h3>
        </div>
        <small>{shapes.length}</small>
      </header>
      <div className="pc-layer-list">
        {shapes.map((shape) => (
          <button
            type="button"
            key={shape.id}
            title="Open this block"
            aria-label={`${shape.props.title}. Open this block.`}
            onClick={() => {
              const editor = runtime.getEditor()
              editor.select(shape.id)
              editor.zoomToSelection({ animation: { duration: 160 } })
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
        <p>
          To use the agent, open this Site in ChatGPT desktop, enable Website Tools for the page,
          then confirm Prompt Canvas appears under Available Website Tools.
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
          <AgentIcon /> Host
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
  const [title, setTitle] = useState('Untitled image project')
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
            <span className="pc-eyebrow">Blank canvas</span>
            <h2 id="blank-workspace-title">Create an image project</h2>
          </div>
          <button className="pc-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></button>
        </header>
        <p>
          Begin with a freeform direction and a useful format choice. You can add more control later.
        </p>
        <label>
          Project title
          <input ref={titleRef} value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={120} />
        </label>
        <label>
          Starting prompt
          <small>Optional. You can write directly on the canvas after creation.</small>
          <textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} />
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
            <PlusIcon /> {submitting ? 'Creating…' : 'Create project'}
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
    await navigator.clipboard.writeText('Generate this Prompt Canvas project.')
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
            <span className="pc-eyebrow">Ready to generate</span>
            <h2 id="generation-context-title">Your project is ready</h2>
          </div>
          <button ref={closeRef} className="pc-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></button>
        </header>
        <p>
          In the Codex chat, send this message. Codex will read the project, create the image,
          and place it in the result card automatically.
        </p>
        <div className="pc-chat-instruction">Generate this Prompt Canvas project.</div>
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
        <footer>
          <button type="button" onClick={() => void copy()}><CopyIcon /> {copied ? 'Copied' : 'Copy message'}</button>
          <button className="pc-primary-button" type="button" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  )
}

export default function App() {
  const snapshot = useRuntimeSnapshot()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [blankOpen, setBlankOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
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
  const workspaceLabels = workspaceOptionLabels(snapshot.workspaces)

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
          <span className="pc-brand-mark"><AppMarkIcon /></span>
          <div><strong>Prompt Canvas</strong><small>Creative image projects</small></div>
        </div>
        <label className="pc-workspace-switcher">
          <select
            value={active?.workspaceId ?? ''}
            disabled={!snapshot.initialized}
            onChange={(event) => runtime.setActiveWorkspace(event.currentTarget.value)}
            aria-label="Active project"
          >
            {!active ? <option value="">{snapshot.initialized ? 'No project open' : 'Loading projects…'}</option> : null}
            {snapshot.workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspaceLabels.get(workspace.workspaceId) ?? workspace.title}</option>
            ))}
          </select>
        </label>
        <div className="pc-topbar__actions">
          <span className={connected ? 'pc-connection-dot is-connected' : 'pc-connection-dot'} title={connectionLabel(snapshot)}><span /></span>
          <button ref={libraryButtonRef} type="button" aria-label="Recipes" onClick={() => setLibraryOpen(true)}><LibraryIcon /><span>Recipes</span></button>
          <button ref={blankButtonRef} type="button" aria-label="New project" onClick={() => setBlankOpen(true)}><PlusIcon /><span>New</span></button>
          <details className="pc-more-menu">
            <summary>More</summary>
            <div>
              <button type="button" disabled={!active} onClick={() => active && void run(() => runtime.duplicateWorkspace(active.workspaceId))}><DuplicateIcon /> Duplicate project</button>
              <button type="button" disabled={!active} onClick={() => active && void run(() => runtime.saveTemplate({ source: { kind: 'workspace', workspaceId: active.workspaceId }, title: `${active.title} copy`, mode: 'fork' }))}><SaveIcon /> Save as recipe</button>
              <button type="button" onClick={() => setInspectorOpen((value) => !value)}><LayersIcon /> {inspectorOpen ? 'Hide diagnostics' : 'Diagnostics'}</button>
            </div>
          </details>
          <button ref={prepareButtonRef} className="pc-primary-button" type="button" disabled={!active} onClick={prepareGeneration}>
            <PlayIcon /><span>Generate with Codex</span>
          </button>
        </div>
      </header>

      <section className={inspectorOpen ? 'pc-main has-inspector' : 'pc-main'}>
        <div className="pc-canvas-shell" aria-label="Prompt project canvas">
          {tldrawLicense.status === 'ready' ? (
            <Tldraw
              persistenceKey="prompt-canvas-document-v1"
              shapeUtils={promptCanvasShapeUtils}
              components={tldrawComponents}
              options={{ maxPages: 100 }}
              onMount={attachEditor}
              colorScheme="light"
              licenseKey={tldrawLicense.key}
              autoFocus
            />
          ) : null}
          {tldrawLicense.status === 'error' ? (
            <div className="pc-loading" role="alert">
              <AppMarkIcon />
              <strong>Prompt Canvas could not open</strong>
              <span>{tldrawLicense.message}</span>
            </div>
          ) : !snapshot.initialized ? (
            <div className="pc-loading" role="status" aria-live="polite"><AppMarkIcon /><strong>Opening Prompt Canvas</strong><span>Loading your projects and recipes…</span></div>
          ) : null}
          <TemplateLibrary
            open={snapshot.initialized && (libraryOpen || !active)}
            dismissible={Boolean(active)}
            onClose={closeLibrary}
            onCreate={async (item) => {
              await run(() => runtime.createWorkspace({
                kind: 'template',
                templateId: item.id,
                ...(item.sourceKind === 'official' ? {
                  origin: 'official' as const,
                  version: item.version,
                  ...(item.hash ? { expectedHash: item.hash } : {}),
                } : item.sourceKind === 'local' ? { origin: 'local' as const, version: item.version } : {}),
              }, 'new-page', true))
              closeLibrary()
              window.requestAnimationFrame(() => {
                runtime.getEditor().setEditingShape(null)
                runtime.getEditor().selectNone()
              })
            }}
            onCreateBlank={() => {
              setLibraryOpen(false)
              setBlankOpen(true)
            }}
          />
        </div>
        {inspectorOpen ? <Inspector snapshot={snapshot} /> : null}
      </section>

      <footer className="pc-statusbar">
        <span><i className={connected ? 'is-live' : ''} /> {active ? 'Your project saves automatically on this device' : 'Choose a recipe to start'}</span>
        <span>{active ? active.generationState.replace(/-/g, ' ') : 'No project open'}</span>
      </footer>

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
