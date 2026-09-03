from pathlib import Path

root = Path(__file__).resolve().parents[1]
styles_path = root / "src/styles.css"
test_path = root / "e2e/prompt-canvas.spec.ts"

styles = styles_path.read_text(encoding="utf-8")
old = """  .pc-topbar__actions > button:nth-of-type(3),
  .pc-topbar__actions > button:nth-of-type(4) { display: none; }
"""
if styles.count(old) != 1:
    raise RuntimeError(f"Expected one stale topbar hiding rule, found {styles.count(old)}.")
styles = styles.replace(old, "", 1)
styles_path.write_text(styles, encoding="utf-8")

tests = test_path.read_text(encoding="utf-8")
marker = "test('compact ChatGPT layouts keep core project actions visible'"
if marker in tests:
    raise RuntimeError("Compact toolbar test already exists.")
tests += r'''


test('compact ChatGPT layouts keep core project actions visible', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 800 })
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Start' }).first().click()

  await expect(page.locator('.pc-topbar .pc-primary-button')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recipes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
})
'''
test_path.write_text(tests, encoding="utf-8")
