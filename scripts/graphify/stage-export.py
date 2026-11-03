"""Preview the three summary files; --copy applies only that exact preview."""
if not __debug__:
    raise RuntimeError('Optimized Python is unsupported: graph safety checks must remain enabled')

import difflib
import hashlib
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd().resolve()
OUT = ROOT / 'graphify-out'
TRIAL = OUT / 'trial'
STAGE = TRIAL / 'vault-preview'
ALLOWED = {'GRAPH_REPORT.md', 'README.md', 'graph.html'}
CONTENT_SECRET = runpy.run_path(str(Path(__file__).with_name('build-local.py')))['CONTENT_SECRET']
README_TEMPLATE = Path(__file__).resolve().parents[2] / 'docs/agents/graphify-trial.md'


def destination():
    value = os.environ.get('WOLF_FORGE_OBSIDIAN_VAULT_PATH')
    if not value or not value.strip():
        value = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('WOLF_FORGE_OBSIDIAN_VAULT_PATH','User')"], text=True).strip()
    if not value or not Path(value).is_dir():
        raise RuntimeError('Missing or inaccessible canonical vault')
    vault = Path(value).resolve()
    target = vault / '02 Projects/Wolf Forge Platform/Code Graph'
    assert target.resolve().is_relative_to(vault), 'Destination leaves vault'
    assert target.resolve() == target, 'Redirected Code Graph destination'
    return target


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def preview():
    meta = json.loads((TRIAL / 'build-metadata.json').read_text(encoding='utf-8'))
    STAGE.mkdir(parents=True, exist_ok=True)
    report = (OUT / 'GRAPH_REPORT.md').read_bytes()
    assert meta['source_commit'] in report.decode('utf-8')
    (STAGE / 'GRAPH_REPORT.md').write_bytes(report)
    header = f"> Source commit: {meta['source_commit']} | Build date: {meta['build_date']} | Graphify {meta['version']}"
    readme = README_TEMPLATE.read_text(encoding='utf-8')
    (STAGE / 'README.md').write_text(header + '\n\n' + readme, encoding='utf-8')
    names = ['GRAPH_REPORT.md', 'README.md']
    html_path = OUT / 'graph.html'
    if html_path.is_file() and not (OUT / '.graph.html.stale').exists():
        html = (f"<!-- Source commit: {meta['source_commit']} | Build date: {meta['build_date']} -->\n".encode() + html_path.read_bytes())
        if len(html) < 10_000_000:
            (STAGE / 'graph.html').write_bytes(html)
            names.append('graph.html')
    target_dir = destination()
    manifest = []
    with (TRIAL / 'external-files.diff').open('w', encoding='utf-8', newline='\n') as patch:
        for name in names:
            source, target = STAGE / name, target_dir / name
            assert not target.is_symlink() and target.parent.resolve() == target_dir.resolve()
            before = target.read_bytes() if target.exists() else b''
            after = source.read_bytes()
            assert not CONTENT_SECRET.search(after.decode('utf-8')), 'Secret-shaped export; values suppressed'
            assert not CONTENT_SECRET.search(before.decode('utf-8-sig')), 'Secret-shaped existing file; values suppressed'
            manifest.append({'source': str(source), 'target': str(target), 'before_sha256': digest(target), 'after_sha256': digest(source), 'bytes': len(after)})
            patch.writelines(difflib.unified_diff(before.decode('utf-8-sig').splitlines(keepends=True), after.decode('utf-8').splitlines(keepends=True), fromfile=str(target) if target.exists() else '/dev/null', tofile=str(target), lineterm='\n'))
            patch.write('\n')
    (TRIAL / 'external-files.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'proposed': {Path(r['target']).name: r['bytes'] for r in manifest}, 'copied': False}))


def copy_reviewed():
    target_dir = destination()
    manifest = json.loads((TRIAL / 'external-files.json').read_text(encoding='utf-8'))
    names = [Path(row['target']).name for row in manifest]
    assert set(names) <= ALLOWED and len(names) == len(set(names))
    assert {'GRAPH_REPORT.md', 'README.md'} <= set(names)
    for row in manifest:
        source, target = Path(row['source']), Path(row['target'])
        assert source.parent.resolve() == STAGE.resolve()
        assert target == target_dir / source.name
        assert not target.is_symlink() and target.parent.resolve() == target_dir.resolve()
        assert digest(source) == row['after_sha256'], 'Preview source changed'
        assert digest(target) == row['before_sha256'], 'Vault target changed'
        assert source.name != 'graph.html' or source.stat().st_size < 10_000_000
    before_names = {p.name for p in target_dir.iterdir()} if target_dir.exists() else set()
    target_dir.mkdir(parents=True, exist_ok=True)
    for row in manifest:
        Path(row['target']).write_bytes(Path(row['source']).read_bytes())
    for row in manifest:
        assert digest(Path(row['target'])) == row['after_sha256'], 'Vault readback mismatch'
    assert {p.name for p in target_dir.iterdir()} == before_names | set(names)
    print(json.dumps({'copied_and_verified': names, 'destination': str(target_dir)}))


if __name__ == '__main__':
    if sys.argv[1:] == ['--copy']:
        copy_reviewed()
    elif not sys.argv[1:]:
        preview()
    else:
        raise SystemExit('Usage: stage-export.py [--copy]')
