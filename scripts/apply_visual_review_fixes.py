from pathlib import Path

path = Path(__file__).resolve().parents[1] / "src/visual-polish.css"
styles = path.read_text(encoding="utf-8")
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
path.write_text(styles, encoding="utf-8")
