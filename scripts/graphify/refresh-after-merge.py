"""Pinned local maintenance. GitHub reads + structural Graphify; no model calls."""
from __future__ import annotations

if not __debug__:
    raise RuntimeError('Optimized Python is unsupported')

import argparse
from contextlib import contextmanager, ExitStack
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import urllib.error
import urllib.request

REPO = 'UplineTonyuo/wolf-forge-platform'
REMOTE = f'https://github.com/{REPO}.git'
NAMES = ('GRAPH_REPORT.md', 'README.md', 'graph.html')
JOBS = {'static lint boundary', 'TypeScript compile boundary', 'compiled app and PDF font trace',
        'JavaScript and TypeScript tests', 'local Supabase pgTAP and RLS tests',
        'production dependency vulnerabilities', 'repository and history secret scan'}
PROGRAM_FILES = ('scripts/graphify/refresh-after-merge.py', 'scripts/graphify/build-local.py',
                 'scripts/graphify/stage-export.py',
                 'docs/agents/graphify-trial.md')


class Pending(RuntimeError):
    """Evidence is not yet sufficient; keep the published snapshot."""


class Busy(RuntimeError):
    """Another process owns the file."""


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def checked_sha(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{40}', value):
        raise RuntimeError('Invalid commit SHA')
    return value


def atomic_json(path, value):
    safe_path(path.parent)
    safe_path(path)
    temp = path.with_name(path.name + '.tmp')
    safe_path(temp)
    with temp.open('wb') as stream:
        stream.write((json.dumps(value, indent=2) + '\n').encode('utf-8'))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def safe_path(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise RuntimeError('Redirected or relative path refused')
    for part in (path, *path.parents):
        if part.exists() and getattr(part.lstat(), 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Reparse-point path refused')
    return path


def environment_path(name):
    value = os.environ.get(name, '').strip()
    if not value:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                                 f"[Environment]::GetEnvironmentVariable('{name}','User')"],
                                capture_output=True, text=True, timeout=20)
        value = result.stdout.strip() if result.returncode == 0 else ''
    if not value or not Path(value).is_dir():
        raise RuntimeError('Missing canonical path binding')
    return safe_path(Path(value))


def validate_bindings(config):
    vault, memory = environment_path('WOLF_FORGE_OBSIDIAN_VAULT_PATH'), environment_path('WOLF_FORGE_OBSIDIAN_MEMORY_PATH')
    graph = safe_path(Path(config['graph_root']))
    runtime = safe_path(Path(config['runtime']))
    if (vault != Path(config['vault']) or memory != Path(config['memory'])
            or memory != vault / '02 Projects/Wolf Forge Platform/AI Memory'
            or runtime != graph / 'graphify-out/automation' or config['repository'] != REPO):
        raise RuntimeError('Canonical path binding changed')
    for path in (memory / '03 Implementation Log.md', memory.parent / 'Code Graph', runtime):
        safe_path(path)
        if not path.exists():
            raise RuntimeError('Required existing destination missing')


@contextmanager
def exclusive_file(path, create=False):
    """Windows sharing mode zero excludes writers, renames and deletes."""
    path = safe_path(path)
    if os.name != 'nt':
        raise RuntimeError('This automation requires Windows')
    import msvcrt
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                   wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    handle = kernel.CreateFileW(str(path), 0x80000000 | 0x40000000, 0, None, 4 if create else 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        error = ctypes.get_last_error()
        if error in (32, 33):
            raise Busy('File is busy; retry on the next check')
        raise OSError(error, 'Exclusive file open failed')
    with os.fdopen(msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY), 'r+b', buffering=0) as stream:
        yield stream


def child(args, cwd=None, timeout=60, data=None):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never',
           'PYTHONDONTWRITEBYTECODE': '1', 'GRAPHIFY_NO_AUTO_REFRESH': '1'}
    env.pop('PYTHONPATH', None)
    env.pop('PYTHONHOME', None)
    return subprocess.run(args, cwd=cwd, input=data, capture_output=True, timeout=timeout, env=env,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)


def credential(git_exe):
    result = child([git_exe, 'credential', 'fill'], data=b'protocol=https\nhost=github.com\n\n')
    values = dict(line.split('=', 1) for line in result.stdout.decode('utf-8', errors='replace').splitlines() if '=' in line)
    if result.returncode or not values.get('password'):
        raise RuntimeError('GitHub credential unavailable')
    return values['password']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('GitHub API redirect refused')


class GitHub:
    def __init__(self, config):
        self.token = credential(config['git'])
        self.opener = urllib.request.build_opener(NoRedirect)

    def get(self, path):
        if not path.startswith('/') or path.startswith('//') or '..' in path:
            raise RuntimeError('Invalid API path')
        request = urllib.request.Request(f'https://api.github.com/repos/{REPO}{path}', headers={
            'Authorization': f'Bearer {self.token}', 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Wolf-Forge-Graphify-Maintenance'})
        try:
            with self.opener.open(request, timeout=30) as response:
                data = response.read(8_000_001)
            if len(data) > 8_000_000:
                raise RuntimeError('GitHub response too large')
            return json.loads(data)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'GitHub API HTTP {error.code}; no credentials logged') from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError('GitHub unavailable; previous snapshot preserved') from None

    def pages(self, path, key=None):
        rows = []
        for page in range(1, 12):
            response = self.get(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
            batch = response[key] if key else response
            if not isinstance(batch, list):
                raise RuntimeError('Unexpected GitHub response')
            rows.extend(batch)
            if len(batch) < 100:
                return rows
        raise RuntimeError('GitHub history exceeds bounded page limit; manual review required')


def merged_prs(api, sha):
    rows = api.pages(f'/commits/{checked_sha(sha)}/pulls')
    result = []
    for pr in rows:
        base = pr.get('base', {})
        if (pr.get('merged_at') and base.get('ref') == 'main'
                and base.get('repo', {}).get('full_name') == REPO):
            number = pr.get('number')
            if type(number) is not int or number <= 0:
                raise RuntimeError('Invalid PR number')
            detail = api.get(f'/pulls/{number}')
            if (detail.get('merged') is True and detail.get('merged_at') and detail.get('merge_commit_sha') == sha
                    and detail.get('base', {}).get('ref') == 'main'
                    and detail.get('base', {}).get('repo', {}).get('full_name') == REPO):
                result.append(number)
    return sorted(set(result))


def verified_snapshot(api, sha):
    checked_sha(sha)
    prs = merged_prs(api, sha)
    if len(prs) != 1:
        raise Pending('Main SHA must match exactly one merged PR targeting main')
    runs = api.pages(f'/actions/workflows/security.yml/runs?branch=main&event=push&head_sha={sha}', 'workflow_runs')
    if not runs:
        raise Pending('Exact-main security run missing')
    run = max(runs, key=lambda row: (row['created_at'], row['id']))
    if run.get('status') != 'completed' or run.get('conclusion') != 'success':
        raise Pending('Latest exact-main security run has not passed')
    run = api.get(f'/actions/runs/{int(run["id"])}')
    if (run.get('head_sha') != sha or run.get('head_branch') != 'main' or run.get('event') != 'push'
            or run.get('path') != '.github/workflows/security.yml' or run.get('status') != 'completed'
            or run.get('conclusion') != 'success'):
        raise Pending('Security evidence changed or does not match exact main SHA')
    jobs = api.pages(f'/actions/runs/{int(run["id"])}/jobs?filter=latest', 'jobs')
    names = [job.get('name') for job in jobs]
    if (not JOBS <= set(names) or len(names) != len(set(names))
            or any(job.get('status') != 'completed' or job.get('conclusion') != 'success' for job in jobs)):
        raise Pending('All seven expected security jobs must pass without skips')
    statuses = [row for row in api.pages(f'/commits/{sha}/statuses') if row.get('context') == 'Vercel']
    if not statuses or max(statuses, key=lambda row: (row['created_at'], row['id'])).get('state') != 'success':
        raise Pending('Latest exact-SHA Vercel status has not passed')
    final = api.get(f'/actions/runs/{int(run["id"])}')
    if (final.get('run_attempt') != run.get('run_attempt') or final.get('status') != 'completed'
            or final.get('conclusion') != 'success'):
        raise Pending('Security run changed during verification')
    return dict(sha=sha, run_id=int(run['id']), run_attempt=int(run['run_attempt']), prs=prs, verified_at=now())


def git(config, *args, ok=(0,)):
    hooks = str(Path(config['runtime']) / 'no-hooks')
    result = child([config['git'], '-c', f'core.hooksPath={hooks}', '-c', 'maintenance.auto=false', *args], cwd=config['graph_root'])
    if result.returncode not in ok:
        raise RuntimeError(f'Git {args[0]} failed; source files preserved')
    return result.stdout.decode('utf-8').strip()


def validate_checkout(config):
    root = Path(config['graph_root'])
    if Path(git(config, 'rev-parse', '--show-toplevel')) != root or git(config, 'remote', 'get-url', 'origin') != REMOTE:
        raise RuntimeError('Unexpected graph checkout or remote')
    if git(config, 'symbolic-ref', '-q', 'HEAD', ok=(0, 1)) or git(config, 'status', '--porcelain', '--untracked-files=all'):
        raise RuntimeError('Graph checkout must be detached and clean, including untracked source')


def validate_program(config):
    program = Path(config['runtime']) / 'program'
    if set(config['program_hashes']) != set(PROGRAM_FILES):
        raise RuntimeError('Unexpected installed program manifest')
    for name, digest in config['program_hashes'].items():
        path = safe_path(program / name)
        if sha256(path.read_bytes()) != digest:
            raise RuntimeError('Installed program changed; review and reinstall required')


def log_entry(evidence, metadata, previous):
    sha = checked_sha(evidence['sha'])
    prs = ', '.join(f'[#{n}](https://github.com/{REPO}/pull/{n})' for n in evidence['prs'])
    return (f'\n\n## {evidence["verified_at"]} — Wolf Forge merge automation — graph snapshot\n\n'
            f'Published source: `{sha}` on `{REPO}/main`.\n'
            f'Merged PRs covered since `{previous}`: {prs}.\n'
            f'Verification: https://github.com/{REPO}/actions/runs/{evidence["run_id"]}, attempt {evidence["run_attempt"]}; '
            'seven expected jobs successful; exact-SHA Vercel status successful. This records CI evidence, '
            'not a new hosted-security or product-acceptance test.\n'
            f'Graph: Graphify 0.9.90, structural parsing, no model extraction; {metadata["files"]} files, '
            f'{metadata["nodes"]} nodes, {metadata["edges"]} edges.\n'
            'Saved and read back: Code Graph/GRAPH_REPORT.md, README.md, graph.html; file hashes are in the local publication receipt.\n'
            'Curated memory review: remains with the memory steward; this entry makes no decision, '
            'security-control or deployed-behavior claim.\n'
            f'<!-- wolf-forge-graphify-merge:{sha} -->\n').encode('utf-8')


def write_handle(stream, data):
    stream.seek(0)
    stream.write(data)
    stream.truncate()
    stream.flush()
    os.fsync(stream.fileno())


def append_handle(stream, data):
    stream.seek(0, 2)
    stream.write(data)
    stream.flush()
    os.fsync(stream.fileno())


def read_handle(stream):
    stream.seek(0)
    return stream.read()


def interrupted_write(actual, before, after):
    # A journaled in-place write can leave a new prefix followed by the old suffix.
    size = 0
    for left, right in zip(actual, after):
        if left != right:
            break
        size += 1
    return actual == after[:size] + before[size:]


def targets(config):
    memory = Path(config['memory'])
    return {**{name: safe_path(memory.parent / 'Code Graph' / name) for name in NAMES},
            'log': safe_path(memory / '03 Implementation Log.md')}


def clear_pending(runtime):
    # Only our exact owned journal payload names; never recursively delete a path.
    for name in NAMES:
        for suffix in ('before', 'after'):
            path = safe_path(runtime / f'pending-{name}.{suffix}')
            path.unlink(missing_ok=True)
    safe_path(runtime / 'pending.json').unlink(missing_ok=True)


def recover(config):
    runtime = Path(config['runtime'])
    journal = runtime / 'pending.json'
    safe_path(journal)
    if not journal.exists():
        return False
    pending = json.loads(journal.read_text(encoding='utf-8'))
    sha = checked_sha(pending['sha'])
    state = json.loads((runtime / 'state.json').read_text(encoding='utf-8'))
    if state['published_sha'] not in (pending['previous_sha'], sha):
        raise RuntimeError('Publication checkpoint conflict')
    if state['published_sha'] == sha:
        with ExitStack() as stack:
            streams = {name: stack.enter_context(exclusive_file(path)) for name, path in targets(config).items()}
            if any(sha256(read_handle(streams[name])) != pending['after_hashes'][name] for name in NAMES):
                raise RuntimeError('Completed publication changed before cleanup')
            entry = pending['entry'].encode('utf-8')
            log = read_handle(streams['log'])
            size = pending['log_before_size']
            if sha256(log[:size]) != pending['log_before_hash'] or log[size:size + len(entry)] != entry:
                raise RuntimeError('Completed publication log changed before cleanup')
        clear_pending(runtime)
        return True
    payloads = {}
    for name in NAMES:
        before = safe_path(runtime / f'pending-{name}.before').read_bytes()
        after = safe_path(runtime / f'pending-{name}.after').read_bytes()
        if sha256(before) != pending['before_hashes'][name] or sha256(after) != pending['after_hashes'][name]:
            raise RuntimeError('Publication journal payload changed')
        payloads[name] = (before, after)
    with ExitStack() as stack:
        streams = {name: stack.enter_context(exclusive_file(path)) for name, path in targets(config).items()}
        for name, (before, after) in payloads.items():
            actual = read_handle(streams[name])
            if actual not in (before, after) and not (pending.get('writing') == name and interrupted_write(actual, before, after)):
                raise RuntimeError('Vault export changed during interrupted publication')
        original = read_handle(streams['log'])
        size = pending['log_before_size']
        if sha256(original[:size]) != pending['log_before_hash']:
            raise RuntimeError('Implementation history changed during interrupted publication')
        entry = pending['entry'].encode('utf-8')
        tail = original[size:]
        complete = tail.startswith(entry)
        partial = bool(tail) and entry.startswith(tail) and pending.get('writing') == 'log'
        if not complete and not partial and pending.get('writing') == 'log' and tail:
            raise RuntimeError('Implementation log append conflict')
        if not complete and not partial and f'wolf-forge-graphify-merge:{sha}'.encode() in original:
            raise RuntimeError('Conflicting existing merge marker')
        for name, (_, after) in payloads.items():
            if read_handle(streams[name]) != after:
                pending['writing'] = name
                atomic_json(journal, pending)
                write_handle(streams[name], after)
            if read_handle(streams[name]) != after:
                raise RuntimeError('Export readback mismatch')
        if not complete:
            if not partial:
                pending['log_before_size'] = len(original)
                pending['log_before_hash'] = sha256(original)
            pending['writing'] = 'log'
            atomic_json(journal, pending)
            append_handle(streams['log'], entry[len(tail):] if partial else entry)
        log = read_handle(streams['log'])
        size = pending['log_before_size']
        if sha256(log[:size]) != pending['log_before_hash'] or log[size:size + len(entry)] != entry:
            raise RuntimeError('Implementation log readback mismatch')
        receipt = {key: pending[key] for key in ('sha', 'previous_sha', 'after_hashes', 'evidence', 'metadata')}
        receipt.update(saved_at=now(), log_sha256=sha256(log))
        atomic_json(runtime / f'receipt-{sha}.json', receipt)
        atomic_json(runtime / 'state.json', dict(published_sha=sha, export_hashes=pending['after_hashes'], last_success=now()))
    clear_pending(runtime)
    receipts = sorted(runtime.glob('receipt-*.json'), key=lambda path: path.stat().st_mtime, reverse=True)
    for path in receipts[20:]:
        if re.fullmatch('receipt-[0-9a-f]{40}\\.json', path.name):
            safe_path(path).unlink()
    return True


def publish(config, evidence, metadata, staged):
    sha = checked_sha(evidence['sha'])
    if (metadata.get('source_commit') != sha or metadata.get('version') != '0.9.90'
            or metadata.get('input_tokens') != 0 or metadata.get('output_tokens') != 0):
        raise RuntimeError('Build SHA/version/model-token evidence invalid')
    if any(type(metadata.get(name)) is not int or metadata[name] <= 0 for name in ('files', 'nodes', 'edges')):
        raise RuntimeError('Invalid graph counts')
    runtime = Path(config['runtime'])
    recover(config)
    state = json.loads((runtime / 'state.json').read_text(encoding='utf-8'))
    if state['published_sha'] == sha:
        return
    secret = runpy.run_path(str(Path(__file__).with_name('build-local.py')))['CONTENT_SECRET']
    payloads = {}
    for name in NAMES:
        path = safe_path(Path(staged) / name)
        if not path.is_file() or (name == 'graph.html' and path.stat().st_size >= 10_000_000):
            raise RuntimeError('All three fresh exports are required; HTML must be below 10 MB')
        data = path.read_bytes()
        text = data.decode('utf-8')
        if sha not in text[:1000] or secret.search(text):
            raise RuntimeError('Export provenance or secret guard failed; content suppressed')
        payloads[name] = data
    with ExitStack() as stack:
        streams = {name: stack.enter_context(exclusive_file(path)) for name, path in targets(config).items()}
        before = {name: read_handle(streams[name]) for name in NAMES}
        if any(sha256(data) != state['export_hashes'][name] for name, data in before.items()):
            raise RuntimeError('Vault export changed since last approved publication')
        original = read_handle(streams['log'])
        if f'wolf-forge-graphify-merge:{sha}'.encode() in original:
            raise RuntimeError('Existing merge marker without matching checkpoint')
        pending = dict(sha=sha, previous_sha=state['published_sha'], evidence=evidence, metadata=metadata,
                       before_hashes={name: sha256(data) for name, data in before.items()},
                       after_hashes={name: sha256(data) for name, data in payloads.items()},
                       log_before_size=len(original), log_before_hash=sha256(original),
                       entry=log_entry(evidence, metadata, state['published_sha']).decode('utf-8'), writing=None)
        for name in NAMES:
            for suffix, data in (('before', before[name]), ('after', payloads[name])):
                path = safe_path(runtime / f'pending-{name}.{suffix}')
                with path.open('wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
        atomic_json(runtime / 'pending.json', pending)
    recover(config)


def build_snapshot(config, api, evidence, previous):
    sha = evidence['sha']
    git(config, 'fetch', '--no-tags', 'origin', 'main')
    ancestry = child([config['git'], 'merge-base', '--is-ancestor', previous, sha], cwd=config['graph_root'])
    if ancestry.returncode != 0:
        raise RuntimeError('Main history no longer descends from the published checkpoint')
    commits = git(config, 'rev-list', '--first-parent', '--reverse', f'{previous}..{sha}').splitlines()
    evidence['prs'] = covered_prs(api, commits, evidence['prs'])
    prepare_checkout(config, sha)
    program = Path(config['runtime']) / 'program'
    for script, args in (('build-local.py', ['--build']), ('stage-export.py', [])):
        result = child([config['python'], '-I', '-B', str(program / 'scripts/graphify' / script), *args], cwd=config['graph_root'], timeout=600)
        if result.returncode:
            raise RuntimeError(f'{script} failed; published exports preserved')
    graph = Path(config['graph_root']) / 'graphify-out'
    stage = graph / 'trial/vault-preview'
    manifest = json.loads((graph / 'trial/external-files.json').read_text(encoding='utf-8'))
    if {Path(row['target']).name for row in manifest} != set(NAMES) or (graph / '.graph.html.stale').exists():
        raise RuntimeError('Missing, stale or oversized HTML; previous complete export set preserved')
    metadata = json.loads((graph / 'trial/build-metadata.json').read_text(encoding='utf-8'))
    validate_checkout(config)
    if git(config, 'rev-parse', 'HEAD') != sha or api.get('/git/ref/heads/main')['object']['sha'] != sha:
        raise Pending('Source or main advanced during build; retry latest verified snapshot')
    fresh = verified_snapshot(api, sha)
    if fresh['run_id'] != evidence['run_id'] or fresh['run_attempt'] != evidence['run_attempt']:
        raise Pending('CI evidence changed during build')
    publish(config, evidence, metadata, stage)


def covered_prs(api, commits, latest):
    if len(commits) > 100:
        raise RuntimeError('More than 100 offline commits; manual catch-up review required')
    covered = set(latest)
    for commit in commits:
        covered.update(merged_prs(api, commit))
    return sorted(covered)


def prepare_checkout(config, sha):
    if git(config, 'ls-tree', '-r', '--name-only', checked_sha(sha), '--', 'graphify-out'):
        raise RuntimeError('Incoming tree tracks reserved graphify-out runtime paths')
    validate_checkout(config)
    git(config, 'switch', '--no-overwrite-ignore', '--detach', sha)
    validate_program(config)


def run(config, check_only=False):
    validate_bindings(config)
    validate_program(config)
    validate_checkout(config)
    if not check_only:
        recover(config)
    api = GitHub(config)
    sha = checked_sha(api.get('/git/ref/heads/main')['object']['sha'])
    state = json.loads((Path(config['runtime']) / 'state.json').read_text(encoding='utf-8'))
    if not check_only and state['published_sha'] == sha:
        return 'unchanged'
    evidence = verified_snapshot(api, sha)
    if check_only:
        return evidence
    build_snapshot(config, api, evidence, checked_sha(state['published_sha']))
    return 'published'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    path = safe_path(Path(args.config))
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    runtime = safe_path(Path(config['runtime']))
    if path != runtime / 'config.json':
        raise RuntimeError('Unexpected runtime config path')
    try:
        with exclusive_file(runtime / 'job.lock', create=True):
            try:
                result = run(config, args.check_only)
                atomic_json(runtime / 'status.json', dict(checked_at=now(), state='verified' if args.check_only else result,
                                                         evidence=result if args.check_only else None))
            except Pending as error:
                atomic_json(runtime / 'status.json', dict(checked_at=now(), state='waiting', reason=str(error)))
                return 0
            except Exception as error:
                reason = str(error) if type(error) is RuntimeError else type(error).__name__
                atomic_json(runtime / 'status.json', dict(checked_at=now(), state='error', reason=reason))
                return 1
    except Busy:
        return 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
