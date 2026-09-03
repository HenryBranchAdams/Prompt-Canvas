from pathlib import Path

path = Path('scripts/apply_collaboration_polish.py')
text = path.read_text(encoding='utf-8')
old = "    new_dialogs,\n    app,"
new = "    lambda _match: new_dialogs,\n    app,"
if text.count(old) != 1:
    raise RuntimeError(f'Expected one applicator replacement target, found {text.count(old)}.')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
