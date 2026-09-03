from pathlib import Path

root = Path(__file__).resolve().parents[1]
styles_path = root / "src/visual-polish.css"
app_path = root / "src/app/App.tsx"
e2e_path = root / "e2e/template-expansion.spec.ts"

styles = styles_path.read_text(encoding="utf-8")
marker = "/* Post-screenshot refinements */"
if marker in styles:
    raise RuntimeError("Post-screenshot refinements already applied.")

styles += r'''

/* Post-screenshot refinements */

/* The gallery autofocus belongs to the search container, not a second ring on the input. */
.pc-search-field input:focus-visible {
  outline: none;
}

/* A disabled generation action should read as unavailable, not as a faded active CTA. */
.pc-topbar .pc-primary-button:disabled {
  border-color: #e0e3e0 !important;
  background: #eef0ed !important;
  color: #9ba2a7 !important;
  box-shadow: none;
  opacity: 1;
}

.pc-output-empty .pc-primary-button {
  box-shadow: 0 7px 16px rgba(82, 102, 213, 0.16);
}
'''
styles_path.write_text(styles, encoding="utf-8")

app = app_path.read_text(encoding="utf-8")
old = '''          <button ref={prepareButtonRef} className="pc-primary-button" type="button" disabled={!active} onClick={prepareGeneration}>
            <PlayIcon /><span>Ask Codex to generate</span>
          </button>'''
new = '''          <button
            ref={prepareButtonRef}
            className="pc-primary-button"
            type="button"
            aria-label="Ask Codex to generate"
            disabled={!active}
            onClick={prepareGeneration}
          >
            <PlayIcon /><span>Ask Codex to generate</span>
          </button>'''
count = app.count(old)
if count != 1:
    raise RuntimeError(f"Expected one compact generation action, found {count}.")
app_path.write_text(app.replace(old, new, 1), encoding="utf-8")

e2e = e2e_path.read_text(encoding="utf-8")
old_ready = '''    return Boolean(body) && body!.scrollHeight - body!.clientHeight <= 1 &&
      textareas.every((textarea) => textarea.scrollHeight - textarea.clientHeight <= 1)'''
new_ready = '''    return Boolean(body) && textareas.length > 0 &&
      body!.scrollHeight - body!.clientHeight <= 1 &&
      textareas.every((textarea) => textarea.scrollHeight - textarea.clientHeight <= 1)'''
ready_count = e2e.count(old_ready)
if ready_count != 1:
    raise RuntimeError(f"Expected one prompt-card readiness check, found {ready_count}.")
e2e_path.write_text(e2e.replace(old_ready, new_ready, 1), encoding="utf-8")
