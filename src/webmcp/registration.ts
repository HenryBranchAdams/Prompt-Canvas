export type WebMcpConnection = {
  checked: boolean
  available: boolean
  registered: number
  failed: number
  errors: string[]
}

export type WebMcpTool = {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    untrustedContentHint?: boolean
  }
  execute: (input: unknown) => unknown | Promise<unknown>
}

export type ModelContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
}

type RegistrationOptions = {
  tools: WebMcpTool[]
  onConnection: (connection: WebMcpConnection) => void
  retryIntervalMs?: number
  timeoutMs?: number
}

function boundedError(error: unknown): string {
  const candidate = error as { name?: unknown; message?: unknown } | null
  const name = typeof candidate?.name === 'string' ? candidate.name.slice(0, 48) : 'Error'
  const message =
    typeof candidate?.message === 'string'
      ? candidate.message.slice(0, 180)
      : typeof error === 'string'
        ? error.slice(0, 180)
        : 'Tool registration was rejected.'
  return `${name}: ${message}`
}

export function registerPromptCanvasTools({
  tools,
  onConnection,
  retryIntervalMs = 400,
  timeoutMs = 12_000,
}: RegistrationOptions): () => void {
  const controller = new AbortController()
  const startedAt = Date.now()
  let timeoutHandle: number | undefined
  let stopped = false
  let registrationInFlight = false
  let sawProviderWithoutRegister = false
  let sawUsableProvider = false
  const registeredNames = new Set<string>()
  const registrationErrors = new Map<string, string>()

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
    controller.abort()
  }

  const retry = () => {
    if (stopped || controller.signal.aborted || registrationInFlight) return
    if (Date.now() - startedAt >= timeoutMs) {
      onConnection({
        checked: true,
        available: sawUsableProvider,
        registered: registeredNames.size,
        failed: tools.length - registeredNames.size,
        errors: sawProviderWithoutRegister && !sawUsableProvider
          ? ['TypeError: document.modelContext.registerTool is not a function.']
          : [...registrationErrors.values()].slice(0, 4),
      })
      return
    }
    timeoutHandle = window.setTimeout(tryProvider, retryIntervalMs)
  }

  const register = (context: ModelContext) => {
    sawUsableProvider = true
    registrationInFlight = true
    const pendingTools = tools.filter((tool) => !registeredNames.has(tool.name))
    onConnection({
      checked: true,
      available: true,
      registered: registeredNames.size,
      failed: pendingTools.length,
      errors: [...registrationErrors.values()].slice(0, 4),
    })
    const registrations = pendingTools.map((tool) => {
      try {
        return Promise.resolve(context.registerTool(tool, { signal: controller.signal }))
      } catch (error) {
        return Promise.reject(error)
      }
    })
    void Promise.allSettled(registrations).then((results) => {
      if (stopped || controller.signal.aborted) return
      results.forEach((result, index) => {
        const tool = pendingTools[index]
        if (result.status === 'fulfilled') {
          registeredNames.add(tool.name)
          registrationErrors.delete(tool.name)
        } else {
          registrationErrors.set(tool.name, boundedError(result.reason))
        }
      })
      registrationInFlight = false
      const failed = tools.length - registeredNames.size
      onConnection({
        checked: true,
        available: true,
        registered: registeredNames.size,
        failed,
        errors: [...registrationErrors.values()].slice(0, 4),
      })
      if (failed > 0) retry()
    })
  }

  function tryProvider() {
    if (stopped || controller.signal.aborted || registrationInFlight) return
    let context: ModelContext | undefined
    try {
      context = document.modelContext
    } catch {
      context = undefined
    }
    if (!context || typeof context.registerTool !== 'function') {
      sawProviderWithoutRegister ||= Boolean(context)
      retry()
      return
    }
    register(context)
  }

  onConnection({ checked: false, available: false, registered: 0, failed: 0, errors: [] })
  tryProvider()
  return stop
}
