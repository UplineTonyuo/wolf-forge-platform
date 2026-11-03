"""Read-only live-view tests against owned publication fixtures."""
import hashlib
import http.client
import json
from pathlib import Path
import runpy
import tempfile
import threading
import unittest

SCRIPTS = Path(__file__).resolve().parent
OLD, NEW = 'a' * 40, 'b' * 40


class LiveViewTests(unittest.TestCase):
    def setUp(self):
        path = SCRIPTS / 'serve-universe.py'
        self.assertTrue(path.exists(), 'Live universe host is not implemented')
        self.api = runpy.run_path(str(path))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.graph = self.root / 'graph'
        self.exports = self.root / 'Code Graph'
        self.runtime = self.graph / 'graphify-out/automation'
        self.trial = self.graph / 'graphify-out/trial'
        self.runtime.mkdir(parents=True)
        self.trial.mkdir(parents=True)
        self.exports.mkdir()
        self.renderer = runpy.run_path(str(SCRIPTS / 'export-universe.py'))
        self.publish(OLD, legacy=True)
        self.store = self.api['SnapshotStore'](self.graph, self.exports, SCRIPTS)

    def publish(self, sha, legacy=False):
        graph = {'built_at_commit': sha, 'graph': {'graphify_version': '0.9.90'},
                 'nodes': [{'id': 'test', 'label': 'Symbol ' + sha[0], 'source_file': 'src/example.ts', 'community': 0}], 'links': []}
        meta = {'source_commit': sha, 'version': '0.9.90', 'build_date': '2026-11-04T00:00:00Z', 'nodes': 1, 'edges': 0, 'files': 1}
        (self.graph / 'graphify-out/graph.json').write_text(json.dumps(graph), encoding='utf-8')
        (self.trial / 'build-metadata.json').write_text(json.dumps(meta), encoding='utf-8')
        body = '<html><title>Legacy graph</title></html>' if legacy else self.renderer['render_html'](self.renderer['build_payload'](graph, meta))
        html = ('<!-- Source commit: ' + sha + ' -->\n' + body).encode()
        (self.exports / 'graph.html').write_bytes(html)
        (self.runtime / 'state.json').write_text(json.dumps({'published_sha': sha, 'export_hashes': {'graph.html': hashlib.sha256(html).hexdigest()}}))
        (self.runtime / 'status.json').write_text(json.dumps({'state': 'unchanged'}))

    def test_legacy_publication_renders_universe_without_writing_source_or_vault(self):
        paths = list(self.root.rglob('*'))
        before = {p: p.read_bytes() for p in paths if p.is_file()}
        snapshot, state = self.store.snapshot()
        self.assertEqual(snapshot['source'], OLD)
        self.assertIn(b'Wolf Forge Universe', snapshot['html'])
        self.assertEqual(state, 'ready')
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    def test_complete_publication_changes_version_and_serves_new_source(self):
        previous, _ = self.store.snapshot()
        self.publish(NEW)
        current, state = self.store.snapshot()
        self.assertNotEqual(previous['version'], current['version'])
        self.assertEqual(current['source'], NEW)
        self.assertIn(NEW.encode(), current['html'])
        self.assertIn(b'data-default-layout="wolf"', current['html'])
        self.assertIn(b'id="galaxy-layout"', current['html'])
        self.assertEqual(state, 'ready')

    def test_incomplete_or_changed_export_keeps_last_verified_snapshot(self):
        previous, _ = self.store.snapshot()
        (self.runtime / 'pending.json').write_text('{}')
        self.publish(NEW)
        current, state = self.store.snapshot()
        self.assertEqual(current['version'], previous['version'])
        self.assertEqual(state, 'waiting')
        (self.runtime / 'pending.json').unlink()
        (self.exports / 'graph.html').write_bytes(b'unapproved edit')
        current, state = self.store.snapshot()
        self.assertEqual(current['source'], OLD)
        self.assertEqual(state, 'error')

    def test_cold_start_refuses_mismatched_graph_data(self):
        path = self.trial / 'build-metadata.json'
        data = json.loads(path.read_text())
        data['source_commit'] = NEW
        path.write_text(json.dumps(data))
        with self.assertRaises(self.api['Unavailable']):
            self.store.snapshot()

    def start_server(self):
        server = self.api['make_server'](self.store, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def request(self, server, path, method='GET', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_http_shell_version_and_frame_are_local_and_read_only(self):
        server = self.start_server()
        self.assertEqual(server.server_address[0], '127.0.0.1')
        status, headers, shell = self.request(server, '/graph.html')
        self.assertEqual(status, 200)
        self.assertIn(b'graph-version.json', shell)
        self.assertIn("connect-src 'self'", headers['Content-Security-Policy'])
        status, _, body = self.request(server, '/graph-version.json')
        version = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(version['source'], OLD)
        self.publish(NEW)
        _, _, body = self.request(server, '/graph-version.json')
        self.assertNotEqual(json.loads(body)['version'], version['version'])
        status, headers, body = self.request(server, '/snapshot.html')
        self.assertEqual(status, 200)
        self.assertIn(b'data-live-source="' + NEW.encode(), body)
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_http_refuses_foreign_hosts_origins_paths_and_writes(self):
        server = self.start_server()
        for path, method, headers, expected in (
            ('/graph.html', 'GET', {'Host': 'attacker.invalid'}, 403),
            ('/graph-version.json', 'GET', {'Origin': 'https://attacker.invalid'}, 403),
            ('/snapshot.html', 'GET', {'Sec-Fetch-Site': 'cross-site'}, 403),
            ('/config.json', 'GET', {}, 404),
            ('/%2e%2e/config.json', 'GET', {}, 404),
            ('/graph.html', 'POST', {}, 405),
        ):
            with self.subTest(path=path, method=method):
                self.assertEqual(self.request(server, path, method, headers)[0], expected)

if __name__ == '__main__':
    unittest.main()
