from pathlib import Path

root = Path(__file__).resolve().parents[1]
styles_path = root / 'src/styles.css'
e2e_path = root / 'e2e/prompt-canvas.spec.ts'

styles = styles_path.read_text(encoding='utf-8')
old = '''  .pc-topbar__actions > button:nth-of-type(3),
  .pc-topbar__actions > button:nth-of-type(4) { display: none; }
'''
if styles.count(old) != 1:
    raise RuntimeError(f'Expected one positional toolbar hiding rule, found {styles.count(old)}.')
styles_path.write_text(styles.replace(old, '', 1), encoding='utf-8')

e2e = e2e_path.read_text(encoding='utf-8')
name = "compact ChatGPT layouts keep collaboration actions visible"
if name not in e2e:
    e2e += '''


test('compact ChatGPT layouts keep collaboration actions visible', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 800 })
  await page.goto('/')
  await expect(page.locator('.pc-loading')).toBeHidden({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Start' }).first().click()

  await expect(page.getByRole('button', { name: 'Recipes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Help me shape it' })).toBeVisible()
  await expect(page.locator('.pc-topbar').getByRole('button', { name: 'Ask Codex to generate' })).toBeVisible()
})
'''
e2e_path.write_text(e2e, encoding='utf-8')

print('Applied compact ChatGPT toolbar fix and regression coverage.')
