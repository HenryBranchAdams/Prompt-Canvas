import { expect, test, type Page } from '@playwright/test'
import { webmcpCatalog } from '../src/generated/webmcpCatalog'

type Tool = { name: string; execute(input: unknown): Promise<unknown> | unknown }
type Registry = { __workspaceLifecycleTools: Record<string, Tool> }

async function invoke<T>(page: Page, name: string, input: unknown): Promise<T> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = (window as unknown as Registry).__workspaceLifecycleTools[toolName]
      if (!tool) throw new Error(`Tool ${toolName} was not registered.`)
      return await tool.execute(toolInput) as T
    },
    { toolName: name, toolInput: input },
  )
}

test('workspace deletion requires confirmation and revision, keeps a valid workspace selected, and is undoable', async ({ page }) => {
  const expectedToolNames = webmcpCatalog.tools.map((tool) => tool.name).sort()
  await page.addInitScript(() => {
    const tools: Record<string, Tool> = {}
    Object.defineProperty(window, '__workspaceLifecycleTools', { configurable: true, value: tools })
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: Tool) {
          tools[tool.name] = tool
          return Promise.resolve()
        },
      },
    })
  })

  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(
    (requiredNames: string[]) => {
      const registered = Object.keys((window as unknown as Registry).__workspaceLifecycleTools).sort()
      return registered.length === requiredNames.length && registered.every((name, index) => name === requiredNames[index])
    },
    expectedToolNames,
  )
  expect(await page.evaluate(() => Object.keys((window as unknown as Registry).__workspaceLifecycleTools).sort()))
    .toEqual(expectedToolNames)

  await invoke(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'template', templateId: 'create-from-words', values: {} },
    openAfterCreate: true,
  })

  const original = await invoke<{ workspace: { workspaceId: string }; revision: number }>(
    page,
    'prompt_canvas_inspect',
    {},
  )
  const created = await invoke<{ workspaceId: string }>(page, 'prompt_canvas_create_workspace', {
    source: { kind: 'blank', title: 'Deletion destination', prompt: 'Keep this workspace.' },
    openAfterCreate: false,
  })

  await expect(invoke(page, 'prompt_canvas_delete_workspace', {
    workspaceId: original.workspace.workspaceId,
    expectedRevision: original.revision,
    confirmed: false,
  })).rejects.toThrow(/Invalid input.*confirmed/)
  await expect(invoke(page, 'prompt_canvas_delete_workspace', {
    workspaceId: original.workspace.workspaceId,
    expectedRevision: original.revision + 1,
    confirmed: true,
  })).rejects.toThrow(/Stale workspace revision/)

  const deleted = await invoke<{
    deletedWorkspaceId: string
    deletedPageId: string
    remainingWorkspaceCount: number
    activeWorkspaceId: string
    undoAvailable: boolean
  }>(page, 'prompt_canvas_delete_workspace', {
    workspaceId: original.workspace.workspaceId,
    expectedRevision: original.revision,
    confirmed: true,
  })
  expect(deleted).toMatchObject({
    deletedWorkspaceId: original.workspace.workspaceId,
    remainingWorkspaceCount: 1,
    activeWorkspaceId: created.workspaceId,
    undoAvailable: true,
  })
  expect(deleted.deletedPageId).toBeTruthy()
  await expect.poll(async () => {
    const current = await invoke<{ workspace: { workspaceId: string } }>(page, 'prompt_canvas_inspect', {})
    return current.workspace.workspaceId
  }).toBe(created.workspaceId)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => {
    try {
      await invoke(page, 'prompt_canvas_inspect', { workspaceId: original.workspace.workspaceId })
      return true
    } catch {
      return false
    }
  }).toBe(true)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => {
    try {
      await invoke(page, 'prompt_canvas_inspect', { workspaceId: original.workspace.workspaceId })
      return false
    } catch {
      return true
    }
  }).toBe(true)

  const remaining = await invoke<{ revision: number }>(page, 'prompt_canvas_inspect', {
    workspaceId: created.workspaceId,
  })
  await expect(invoke(page, 'prompt_canvas_delete_workspace', {
    workspaceId: created.workspaceId,
    expectedRevision: remaining.revision,
    confirmed: true,
  })).rejects.toThrow(/only remaining Prompt Canvas workspace/)
})

test('startup prunes legacy activity rows to the default retention window', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('prompt-canvas-local')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('activity', 'readwrite')
      const store = transaction.objectStore('activity')
      for (let index = 0; index < 305; index += 1) {
        store.put({
          id: `legacy-${index.toString().padStart(3, '0')}`,
          at: new Date(Date.UTC(2030, 0, 1, 0, 0, index)).toISOString(),
          source: 'system',
          kind: 'legacy-test',
          summary: `Legacy activity ${index}`,
          status: 'info',
        })
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })

  await page.reload()
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })
  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('prompt-canvas-local')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction('activity', 'readonly').objectStore('activity').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return count
  })).toBe(300)
})
