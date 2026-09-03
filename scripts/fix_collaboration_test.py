from pathlib import Path

path = Path('scripts/apply_collaboration_polish.py')
text = path.read_text(encoding='utf-8')
old = "  await page.getByRole('button', { name: 'Ask Codex to generate' }).click()"
new = "  await page.locator('.pc-topbar').getByRole('button', { name: 'Ask Codex to generate' }).click()"
if text.count(old) != 1:
    raise RuntimeError(f'Expected one collaboration test locator target, found {text.count(old)}.')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
