import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const output = 'qa-artifacts/collaboration'
await mkdir(output, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 960 },
  deviceScaleFactor: 1,
})
await context.addInitScript(() => {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool() {
        return Promise.resolve()
      },
    },
  })
})
const page = await context.newPage()
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await page.locator('.pc-loading').waitFor({ state: 'hidden', timeout: 30_000 })
await page.screenshot({ path: `${output}/01-recipe-gallery.png`, fullPage: true })

await page.getByRole('button', { name: 'Start' }).first().click()
await page.locator('.pc-panel--output').waitFor({ state: 'visible', timeout: 30_000 })
await page.screenshot({ path: `${output}/02-create-workbench.png`, fullPage: true })

await page.getByRole('button', { name: 'Help me shape it' }).click()
await page.getByRole('heading', { name: 'Ask Codex to help with the brief' }).waitFor()
await page.screenshot({ path: `${output}/03-help-me-shape-it.png`, fullPage: true })
await page.getByRole('button', { name: 'Done' }).click()

await page.locator('.pc-topbar').getByRole('button', { name: 'Ask Codex to generate' }).click()
await page.getByRole('heading', { name: 'Ask Codex to create this image' }).waitFor()
await page.screenshot({ path: `${output}/04-generation-handoff.png`, fullPage: true })

await page.setViewportSize({ width: 760, height: 800 })
await page.getByRole('button', { name: 'Done' }).click()
await page.screenshot({ path: `${output}/05-compact-workbench.png`, fullPage: true })

await browser.close()
