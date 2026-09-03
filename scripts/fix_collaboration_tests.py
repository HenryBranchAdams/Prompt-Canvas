from pathlib import Path

path = Path(__file__).resolve().parents[1] / "e2e/prompt-canvas.spec.ts"
text = path.read_text(encoding="utf-8")
old = "await page.getByRole('button', { name: 'Ask Codex to generate' }).click()"
new = "await page.locator('.pc-topbar').getByRole('button', { name: 'Ask Codex to generate' }).click()"
count = text.count(old)
if count != 1:
    raise RuntimeError(f"Expected one ambiguous collaboration button selector, found {count}.")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
