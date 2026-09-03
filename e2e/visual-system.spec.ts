import { expect, test } from '@playwright/test'

test('visual system keeps the gallery and workspace coherent across desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })

  const gallery = page.locator('.pc-library')
  const firstCard = page.locator('.pc-template-card').first()
  await expect(gallery).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What would you like to make?' })).toBeVisible()
  await expect(page.getByLabel('Search recipes')).toBeVisible()
  await expect(firstCard).toBeVisible()

  const galleryMetrics = await gallery.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(galleryMetrics.scrollWidth).toBeLessThanOrEqual(galleryMetrics.clientWidth + 1)

  const cardRadius = await firstCard.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).borderRadius),
  )
  expect(cardRadius).toBeGreaterThanOrEqual(18)

  await firstCard.getByRole('button', { name: 'Start' }).click()
  await expect(gallery).toBeHidden()
  await expect(page.locator('.pc-panel').first()).toBeVisible()
  await expect(page.locator('.pc-topbar .pc-primary-button')).toBeVisible()

  const panelRadius = await page.locator('.pc-panel').first().evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).borderRadius),
  )
  expect(panelRadius).toBeGreaterThanOrEqual(16)

  await page.setViewportSize({ width: 760, height: 800 })
  const primaryAction = page.locator('.pc-topbar .pc-primary-button')
  await expect(primaryAction).toBeVisible()

  const actionBounds = await primaryAction.boundingBox()
  expect(actionBounds).not.toBeNull()
  expect(actionBounds!.x).toBeGreaterThanOrEqual(0)
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(760)

  const appMetrics = await page.locator('.pc-app').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(appMetrics.scrollWidth).toBeLessThanOrEqual(appMetrics.clientWidth + 1)
})
