from pathlib import Path

root = Path(__file__).resolve().parents[1]
styles_path = root / "src/visual-polish.css"
app_path = root / "src/app/App.tsx"

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
