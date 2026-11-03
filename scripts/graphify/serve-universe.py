"""Loopback-only live view of the last verified Graphify publication. No writes."""
from __future__ import annotations

if not __debug__:
    raise RuntimeError('Optimized Python is unsupported')

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import threading
from urllib.parse import urlsplit
import base64

POLL_SECONDS = 30
SHELL_SCRIPT = r'''
'use strict';
let frame = document.getElementById('snapshot');
const message = document.getElementById('live-status');
const checked = document.getElementById('last-checked');
let version = '', source = '', loading = false, checking = false, refreshState = '';
function showStatus() {
  const prefix = refreshState === 'error' ? 'Publication needs attention' :
    refreshState === 'waiting' ? 'Waiting for verified publication' : 'Auto updates on';
  const text = prefix + (source ? ' · showing ' + source.slice(0,7) : '') + ' · checks every 30s';
  if (message.textContent !== text) message.textContent = text;
}
function loadSnapshot(expectedVersion) {
  loading = true;
  const candidate = document.createElement('iframe');
  candidate.hidden = true;
  candidate.title = frame.title;
  let done = false;
  const finish = success => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    candidate.onload = candidate.onerror = null;
    loading = false;
    if (success) {
      const root = candidate.contentDocument.documentElement;
      version = root.dataset.liveVersion;
      source = root.dataset.liveSource;
      frame.replaceWith(candidate);
      frame = candidate;
      frame.id = 'snapshot';
      frame.hidden = false;
      showStatus();
    } else {
      candidate.remove();
      message.textContent = 'Keeping the last view · snapshot unavailable · retrying automatically';
    }
  };
  const timeout = setTimeout(() => finish(false), 10000);
  candidate.onload = () => {
    try {
      const root = candidate.contentDocument.documentElement;
      finish(root.dataset.liveVersion === expectedVersion && root.dataset.ready === 'true' &&
        /^[0-9a-f]{40}$/.test(root.dataset.liveSource || ''));
    } catch { finish(false); }
  };
  candidate.onerror = () => finish(false);
  candidate.src = '/snapshot.html?v=' + encodeURIComponent(expectedVersion);
  frame.after(candidate);
}
async function checkPublication() {
  if (document.hidden || checking) return;
  checking = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const reply = await fetch('/graph-version.json', {cache:'no-store', signal:controller.signal});
    if (reply.status === 503) { refreshState = 'waiting'; showStatus(); return; }
    if (!reply.ok) throw new Error('Publication unavailable');
    const next = await reply.json();
    if (!/^[0-9a-f]{64}$/.test(next.version)) throw new Error('Invalid publication');
    refreshState = next.state;
    const now = new Date();
    checked.dateTime = now.toISOString();
    checked.textContent = ' · checked ' + now.toLocaleTimeString([], {hour12:false});
    if (next.version !== version && !loading) {
      loadSnapshot(next.version);
    }
    showStatus();
  } catch {
    message.textContent = 'Keeping the last view · connection unavailable · retrying automatically';
  } finally {
    clearTimeout(timeout);
    checking = false;
  }
}
setInterval(checkPublication, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPublication(); });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    frame.contentDocument?.getElementById('search')?.focus();
  }
});
checkPublication();
'''


class Unavailable(RuntimeError):
    """There is no complete verified snapshot to serve yet."""


def plain_bytes(path, root, limit):
    path, root = Path(path).absolute(), Path(root).resolve()
    if path.is_symlink() or not path.resolve().is_relative_to(root) or path.stat().st_size > limit:
        raise ValueError('Invalid publication file boundary')
    return path.read_bytes()


class SnapshotStore:
    def __init__(self, graph_root, exports, renderer_dir=None):
        self.graph = Path(graph_root).resolve()
        self.exports = Path(exports).resolve()
        self.runtime = self.graph / 'graphify-out/automation'
        self.renderer_dir = Path(renderer_dir or Path(__file__).parent).resolve()
        self.renderer = runpy.run_path(str(self.renderer_dir / 'export-universe.py'))
        self.renderer_hash = hashlib.sha256(
            (self.renderer_dir / 'export-universe.py').read_bytes() +
            (self.renderer_dir / 'universe.html').read_bytes()).hexdigest()
        self.cached = None
        self.lock = threading.Lock()

    def _read(self, path, root, limit):
        return plain_bytes(path, root, limit)

    def _candidate(self):
        if (self.runtime / 'pending.json').exists():
            raise Unavailable('Publication in progress')
        state_path = self.runtime / 'state.json'
        before = self._read(state_path, self.runtime, 100_000)
        state = json.loads(before)
        source, export_hash = state['published_sha'], state['export_hashes']['graph.html']
        if not isinstance(source, str) or not re.fullmatch('[0-9a-f]{40}', source):
            raise ValueError('Invalid published source')
        if not isinstance(export_hash, str) or not re.fullmatch('[0-9a-f]{64}', export_hash):
            raise ValueError('Invalid published HTML fingerprint')
        version = hashlib.sha256((source + export_hash + self.renderer_hash).encode()).hexdigest()
        if self.cached and self.cached['version'] == version:
            return self.cached
        html = self._read(self.exports / 'graph.html', self.exports, 10_000_000)
        if hashlib.sha256(html).hexdigest() != export_hash or source.encode() not in html[:1000]:
            raise ValueError('Published HTML fingerprint/provenance mismatch')
        if b'<title>Wolf Forge Universe</title>' not in html:
            # Bootstrap older publications in memory; never overwrite vault exports.
            out = self.graph / 'graphify-out'
            metadata_bytes = self._read(out / 'trial/build-metadata.json', out, 100_000)
            graph_bytes = self._read(out / 'graph.json', out, 100_000_000)
            metadata, graph = json.loads(metadata_bytes), json.loads(graph_bytes)
            if metadata.get('source_commit') != source or graph.get('built_at_commit') != source:
                raise Unavailable('Graph data is in transition')
            html = self.renderer['render_html'](self.renderer['build_payload'](graph, metadata)).encode('utf-8')
            if (self._read(out / 'trial/build-metadata.json', out, 100_000) != metadata_bytes
                    or self._read(out / 'graph.json', out, 100_000_000) != graph_bytes):
                raise Unavailable('Graph data changed during rendering')
        if (self.runtime / 'pending.json').exists() or self._read(state_path, self.runtime, 100_000) != before:
            raise Unavailable('Publication changed during rendering')
        if b'<html ' not in html:
            raise ValueError('Invalid universe document')
        attributes = f'<html data-live-version="{version}" data-live-source="{source}" '.encode()
        html = html.replace(b'<html ', attributes, 1)
        return {'version': version, 'source': source, 'html': html}

    def snapshot(self):
        with self.lock:
            try:
                current = self._candidate()
            except (Unavailable, PermissionError, FileNotFoundError):
                if self.cached is None:
                    raise Unavailable('Waiting for a complete verified publication') from None
                return self.cached, 'waiting'
            except (OSError, ValueError, KeyError, TypeError):
                if self.cached is None:
                    raise Unavailable('Publication could not be verified') from None
                return self.cached, 'error'
            self.cached = current
            return current, 'ready'

    def version(self):
        current, state = self.snapshot()
        try:
            status = json.loads(self._read(self.runtime / 'status.json', self.runtime, 100_000))
            if state == 'ready' and status.get('state') in ('waiting', 'failed', 'error'):
                state = 'waiting' if status['state'] == 'waiting' else 'error'
        except (OSError, ValueError):
            pass
        return {'version': current['version'], 'source': current['source'], 'state': state}


def shell():
    return ('''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wolf Forge Universe · Live</title><style>
html,body{margin:0;height:100%;background:#080d1a;color:#b5c5dd;font:12px Segoe UI,system-ui,sans-serif}
body{display:flex;flex-direction:column}iframe{display:block;flex:1;min-height:0;width:100%;border:0}
iframe[hidden]{display:none}
footer{min-height:28px;box-sizing:border-box;border-top:1px solid #2a3850;padding:6px 12px;line-height:16px}
footer::before{content:'●';color:#83d7bb;margin-right:8px}footer span{overflow-wrap:anywhere}
</style></head><body><iframe id="snapshot" title="Verified Wolf Forge code universe"></iframe>
<footer><span id="live-status" role="status">Connecting to the verified graph…</span><time id="last-checked" aria-label="Last checked"></time></footer>
<script>''' + SHELL_SCRIPT + '</script></body></html>').encode('utf-8')


def make_server(store, port=9137):
    digest = base64.b64encode(hashlib.sha256(SHELL_SCRIPT.encode()).digest()).decode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def allowed(self, path):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            origins = {'http://' + host for host in hosts}
            origin = self.headers.get('Origin')
            return (self.headers.get('Host', '').lower() in hosts
                    and (origin is None or origin in origins)
                    and (path in ('/', '/graph.html') or self.headers.get('Sec-Fetch-Site') != 'cross-site'))

        def respond(self, code, body=b'', content_type='text/plain; charset=utf-8', policy=None):
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Wolf-Forge-Universe', '1')
            self.send_header('X-Frame-Options', 'SAMEORIGIN')
            self.send_header('Referrer-Policy', 'same-origin')
            self.send_header('Content-Security-Policy', policy or "frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
            self.end_headers()
            if self.command != 'HEAD':
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def do_GET(self):
            requested = urlsplit(self.path)
            if requested.scheme or requested.netloc:
                return self.respond(400, b'Invalid request target')
            path = requested.path
            if not self.allowed(path):
                return self.respond(403, b'Forbidden')
            if path in ('/', '/graph.html'):
                policy = (f"default-src 'none'; script-src 'sha256-{digest}'; style-src 'unsafe-inline'; "
                          "connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
                return self.respond(200, shell(), 'text/html; charset=utf-8', policy)
            if path == '/favicon.ico':
                return self.respond(204)
            if path not in ('/graph-version.json', '/snapshot.html'):
                return self.respond(404, b'Not found')
            try:
                if path == '/graph-version.json':
                    return self.respond(200, json.dumps(store.version()).encode(), 'application/json; charset=utf-8')
                current, _state = store.snapshot()
                return self.respond(200, current['html'], 'text/html; charset=utf-8')
            except Unavailable:
                return self.respond(503, b'Waiting for a verified publication')

        do_HEAD = do_GET

        def do_POST(self):
            self.respond(405, b'Read-only viewer')

        do_PUT = do_POST
        do_DELETE = do_POST
        do_PATCH = do_POST

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def machine_binding(name):
    value = os.environ.get(name, '').strip()
    if not value:
        value = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command',
                                         f"[Environment]::GetEnvironmentVariable('{name}','User')"], text=True).strip()
    if not value:
        raise ValueError('Missing machine-local binding')
    return Path(value).resolve(strict=True)


def configured_store(config_path):
    config_path = Path(config_path).resolve(strict=True)
    config = json.loads(config_path.read_text(encoding='utf-8'))
    graph, runtime = Path(config['graph_root']).resolve(), Path(config['runtime']).resolve()
    memory, vault = machine_binding('WOLF_FORGE_OBSIDIAN_MEMORY_PATH'), machine_binding('WOLF_FORGE_OBSIDIAN_VAULT_PATH')
    if (config.get('schema') != 1 or config.get('repository') != 'UplineTonyuo/wolf-forge-platform'
            or runtime != graph / 'graphify-out/automation' or config_path != runtime / 'config.json'
            or Path(config['memory']).resolve() != memory or Path(config['vault']).resolve() != vault
            or not memory.is_relative_to(vault)):
        raise ValueError('Unexpected live viewer machine binding')
    program = runtime / 'program'
    if Path(__file__).resolve() != program / 'scripts/graphify/serve-universe.py':
        raise ValueError('Run the reviewed frozen viewer program')
    runner = runpy.run_path(str(program / 'scripts/graphify/refresh-after-merge.py'))
    runner['validate_program'](config)
    exports = memory.parent / 'Code Graph'
    if exports.resolve() != exports.absolute():
        raise ValueError('Redirected Code Graph destination')
    return SnapshotStore(graph, exports, program / 'scripts/graphify')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--port', type=int, default=9137)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Use a non-privileged local port')
    server = make_server(configured_store(args.config), args.port)
    if sys.stdout is not None:
        print(f'Wolf Forge Universe live: http://127.0.0.1:{args.port}/graph.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
