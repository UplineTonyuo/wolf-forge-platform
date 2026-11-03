"""Local Graphify trial; source checkout is read-only. Never calls a model."""
from __future__ import annotations

if not __debug__:
    raise RuntimeError('Optimized Python is unsupported: graph safety checks must remain enabled')

import hashlib
import importlib.metadata
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd().resolve()
OUT = ROOT / 'graphify-out'
TRIAL = OUT / 'trial'
SCOPES = ['src', 'supabase/migrations', 'supabase/functions', 'scripts', 'docs']
PIN = '0.9.90'
NAME_SECRET = re.compile(r'(?:^|[./_\\-])(?:secrets?|credentials?|passwords?|passwd|private[_-]?keys?)(?:[./_\\-]|$)', re.I)
CONTENT_SECRET = re.compile(
    r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----'
    r'|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'
    r'|\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z_]{6,}\b'
    r'|\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[0-9A-Za-z_]{20,}\b'
    r'|\bsb_secret_[0-9A-Za-z_-]{16,}\b'
    r'|\bxox[abposr]-[0-9A-Za-z-]{10,}\b'
    r'|\bAIza[0-9A-Za-z_-]{35}\b'
    r'|\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b'
    r'|\b[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|PRIVATE_?KEY)[A-Za-z0-9_]*\s*[:=]\s*[\x22\x27\x60][^\x22\x27\x60\s]{20,}[\x22\x27\x60]'
)


def git(*args: str, data: bytes | None = None, ok=(0,)) -> bytes:
    result = subprocess.run(['git', *args], cwd=ROOT, input=data, capture_output=True)
    if result.returncode not in ok:
        raise RuntimeError(f'git {args[0]} failed with exit {result.returncode}')
    return result.stdout


def save(name: str, value) -> None:
    TRIAL.mkdir(parents=True, exist_ok=True)
    (TRIAL / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def run_graphify(*args: str) -> None:
    subprocess.run([sys.executable, '-B', '-m', 'graphify', *args], cwd=ROOT, check=True,
                   env={**os.environ, 'GRAPHIFY_NO_AUTO_REFRESH': '1', 'GRAPHIFY_OUT': str(OUT)})


def corpus():
    os.environ['GRAPHIFY_OUT'] = str(OUT)
    from graphify.detect import _is_sensitive
    from graphify.extract import _DISPATCH
    names = sorted(set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *SCOPES).decode('utf-8').strip('\0').split('\0')) - {''})
    ignored = set(git('check-ignore', '--no-index', '-z', '--stdin', data=('\0'.join(names) + '\0').encode(), ok=(0, 1)).decode().strip('\0').split('\0'))
    accepted, excluded = [], []
    for name in names:
        path = ROOT / name
        parts = name.lower().split('/')
        reason = None
        if name in ignored:
            reason = 'gitignore'
        elif not path.resolve().is_relative_to(ROOT) or path.is_symlink():
            reason = 'symlink or outside checkout'
        elif any(p in {'node_modules', 'outputs', 'graphify-out'} or p.startswith('.next') for p in parts) or name.startswith('supabase/.temp/'):
            reason = 'excluded directory'
        elif any(p.startswith(('.env', '.qa-local-credentials')) for p in parts) or name.lower().endswith('.dpapi') or NAME_SECRET.search(name) or _is_sensitive(path):
            reason = 'sensitive filename'
        elif path.suffix.lower() not in _DISPATCH:
            reason = 'no local structural parser (includes screenshots and fonts)'
        elif CONTENT_SECRET.search(path.read_text(encoding='utf-8', errors='replace')):
            reason = 'secret-shaped content; values never logged'
        if reason:
            excluded.append({'path': name, 'reason': reason})
        else:
            accepted.append({'path': name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    assert accepted and all(any(x['path'].startswith(s + '/') for s in SCOPES) for x in accepted)
    save('corpus-manifest.json', {'scopes': SCOPES, 'files': accepted, 'excluded': excluded})
    print(json.dumps({'accepted': len(accepted), 'bytes': sum(x['bytes'] for x in accepted), 'extensions': dict(Counter(Path(x['path']).suffix for x in accepted)), 'excluded': dict(Counter(x['reason'] for x in excluded))}))
    return accepted


def main():
    assert Path(git('rev-parse', '--show-toplevel').decode().strip()).resolve() == ROOT, 'Run from the source worktree root'
    assert importlib.metadata.version('graphifyy') == PIN
    assert not git('diff', '--name-only').strip(), 'Tracked source changes: stop'
    assert not git('diff', '--cached', '--name-only').strip(), 'Staged changes: stop'
    assert not git('symbolic-ref', '-q', 'HEAD', ok=(0, 1)).strip(), 'Expected detached checkout'
    files = corpus()
    if '--build' not in sys.argv:
        return
    started = time.perf_counter()
    sha = git('rev-parse', 'HEAD').decode().strip()
    stamp = datetime.now(timezone.utc).isoformat()
    from graphify.extract import extract
    from graphify.build import build_from_json
    from graphify.export import to_json
    extraction = extract([ROOT / x['path'] for x in files], root=ROOT, cache_root=OUT, max_workers=4)
    assert not extraction.get('failed_sources'), 'Structural extraction has failed sources'
    assert extraction['input_tokens'] == extraction['output_tokens'] == 0
    graph = build_from_json(extraction, root=str(ROOT), directed=True)
    assert graph.number_of_nodes() > 0
    assert to_json(graph, {}, str(OUT / 'graph.json')), 'Graph write refused'
    (OUT / '.graphify_root').write_text(str(ROOT), encoding='utf-8')
    (OUT / '.graphify_python').write_text(sys.executable, encoding='utf-8')
    # --no-label uses structural labels and prevents LLM community naming.
    run_graphify('cluster-only', str(ROOT), '--no-label')
    for row in files:
        assert hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() == row['sha256'], 'Source changed during build'
    assert git('rev-parse', 'HEAD').decode().strip() == sha
    assert not git('diff', '--name-only').strip()
    metadata = {'version': PIN, 'source_commit': sha, 'build_date': stamp, 'seconds': round(time.perf_counter() - started, 3), 'input_tokens': 0, 'output_tokens': 0, 'nodes': graph.number_of_nodes(), 'edges': graph.number_of_edges(), 'files': len(files), 'mode': 'local structural; Markdown headings/links/mentions; no image semantics'}
    save('build-metadata.json', metadata)
    report = OUT / 'GRAPH_REPORT.md'
    report.write_text(f'> Source commit: {sha} | Build date: {stamp} | Graphify {PIN} | Local structural extraction, 0 LLM tokens\n\n' + report.read_text(encoding='utf-8'), encoding='utf-8')
    print(json.dumps(metadata))


if __name__ == '__main__':
    main()
