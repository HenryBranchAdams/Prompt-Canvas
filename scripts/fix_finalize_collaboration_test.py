from pathlib import Path

path = Path(__file__).resolve().parents[1] / "e2e/prompt-canvas.spec.ts"
text = path.read_text(encoding="utf-8")
old = "  await expect(page.locator('.pc-panel--controls .pc-panel__collaboration-cue').first()).toContainText('You')"
new = "\n".join([
    "  await expect(page.getByText('You edit', { exact: true })).toBeVisible()",
    "  await expect(page.getByText('Codex uses this', { exact: true }).first()).toBeVisible()",
])
count = text.count(old)
if count != 1:
    raise RuntimeError(f"Expected one collaboration cue assertion, found {count}.")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
