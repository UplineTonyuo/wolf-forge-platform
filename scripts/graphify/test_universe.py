"""Exercise the exported artifact and data boundaries, without the real vault."""
import copy
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import runpy
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
SHA = 'a' * 40


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.tags = []
        self.metas = []
        self.active = None

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        attrs = dict(attrs)
        if tag == 'script':
            self.scripts.append([attrs, ''])
            self.active = self.scripts[-1]
        if tag == 'meta':
            self.metas.append(attrs)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = None

    def handle_data(self, data):
        if self.active is not None:
            self.active[1] += data


class UniverseTests(unittest.TestCase):
    def setUp(self):
        path = SCRIPTS / 'export-universe.py'
        self.assertTrue(path.exists(), 'Universe exporter is not implemented')
        self.api = runpy.run_path(str(path))
        self.graph = {'built_at_commit': SHA, 'graph': {'graphify_version': '0.9.90'}, 'nodes': [
            {'id': 'a', 'label': 'Checkout', 'source_file': 'src/components/checkout.tsx', 'source_location': 'L7', 'community': 2, 'metadata': {'private': 'omit me'}},
            {'id': 'b', 'label': 'charge', 'source_file': 'src/services/charge.ts', 'source_location': 'L12', 'community': 3},
        ], 'links': [{'source': 'a', 'target': 'b', 'relation': 'calls', 'context': 'omit source content'}]}
        self.meta = {'source_commit': SHA, 'version': '0.9.90', 'build_date': '2026-11-04T00:00:00+00:00', 'nodes': 2, 'edges': 1, 'files': 2}

    def test_compact_export_preserves_relationships_and_omits_arbitrary_metadata(self):
        before = copy.deepcopy(self.graph)
        data = self.api['build_payload'](self.graph, self.meta)
        self.assertEqual(data['nodes'][0][:5], ['Checkout', 'src/components/checkout.tsx', 'L7', 'Components', '2'])
        self.assertEqual(data['edges'], [[0, 1, 'calls']])
        self.assertEqual(data['meta']['source'], SHA)
        self.assertNotIn('omit me', json.dumps(data))
        self.assertNotIn('omit source content', json.dumps(data))
        self.assertEqual(self.graph, before)

    def test_hostile_labels_remain_inert_json_and_executable_script_matches_csp(self):
        attack = '</script><img src=x onerror=alert(1)>&\u2028'
        self.graph['nodes'][0]['label'] = attack
        html = self.api['render_html'](self.api['build_payload'](self.graph, self.meta))
        parsed = Scripts()
        parsed.feed(html)
        self.assertEqual(len(parsed.scripts), 2)
        self.assertNotIn('img', parsed.tags)
        data = next(body for attrs, body in parsed.scripts if attrs.get('type') == 'application/json')
        self.assertEqual(json.loads(data)['nodes'][0][0], attack)
        executable = next(body for attrs, body in parsed.scripts if attrs.get('id') == 'universe-app')
        import base64
        digest = base64.b64encode(hashlib.sha256(executable.encode()).digest()).decode()
        policy = next(m['content'] for m in parsed.metas if m.get('http-equiv') == 'Content-Security-Policy')
        self.assertIn("'sha256-" + digest + "'", policy)
        self.assertIn("connect-src 'none'", policy)

    def test_bad_graph_boundaries_fail_before_an_existing_export_is_replaced(self):
        for mutation in ('duplicate', 'dangling', 'traversal', 'absolute', 'sha', 'counts'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                graph, meta = copy.deepcopy(self.graph), dict(self.meta)
                if mutation == 'duplicate': graph['nodes'][1]['id'] = 'a'
                if mutation == 'dangling': graph['links'][0]['target'] = 'missing'
                if mutation == 'traversal': graph['nodes'][0]['source_file'] = '../private.txt'
                if mutation == 'absolute': graph['nodes'][0]['source_file'] = 'C:/private.txt'
                if mutation == 'sha': meta['source_commit'] = 'b' * 40
                if mutation == 'counts': meta['nodes'] = 3
                root = Path(temp)
                source, metadata, target = root / 'graph.json', root / 'metadata.json', root / 'graph.html'
                source.write_text(json.dumps(graph), encoding='utf-8')
                metadata.write_text(json.dumps(meta), encoding='utf-8')
                target.write_bytes(b'previous approved HTML')
                source_bytes = source.read_bytes()
                with self.assertRaises(ValueError):
                    self.api['export_universe'](source, metadata, target)
                self.assertEqual(target.read_bytes(), b'previous approved HTML')
                self.assertEqual(source.read_bytes(), source_bytes)

    def test_empty_graph_is_a_valid_browsable_empty_state(self):
        graph = {**self.graph, 'nodes': [], 'links': []}
        data = self.api['build_payload'](graph, {**self.meta, 'nodes': 0, 'edges': 0, 'files': 0})
        self.assertEqual(data['nodes'], [])
        self.assertEqual(data['edges'], [])
        self.assertGreater(len(self.api['render_html'](data)), 500)

    def test_pinned_graphify_null_location_is_an_unknown_source_line(self):
        self.graph['nodes'][0]['source_location'] = None
        data = self.api['build_payload'](self.graph, self.meta)
        self.assertEqual(data['nodes'][0][2], '')

    def test_node_builtin_module_is_external_not_a_local_file(self):
        self.graph['nodes'][0].update(label='node:fs', source_file='node:fs', type='module')
        data = self.api['build_payload'](self.graph, self.meta)
        self.assertEqual(data['nodes'][0][0], 'node:fs')
        self.assertEqual(data['nodes'][0][1], '')
        self.assertEqual(data['nodes'][0][3], 'External')

    def test_oversize_export_is_refused(self):
        data = self.api['build_payload'](self.graph, self.meta)
        data['nodes'][0][0] = 'x' * 10_000_000
        with self.assertRaisesRegex(ValueError, '10 MB'):
            self.api['render_html'](data)

    def test_cluster_failure_preserves_previous_html_and_marks_it_stale(self):
        build = runpy.run_path(str(SCRIPTS / 'build-local.py'))
        protect = build.get('preserve_html')
        self.assertIsNotNone(protect, 'The entire cluster/export sequence must preserve previous HTML')
        for had_previous in (True, False):
            with self.subTest(previous=had_previous), tempfile.TemporaryDirectory() as temp:
                out = Path(temp)
                html = out / 'graph.html'
                if had_previous:
                    html.write_bytes(b'previous universe')
                with self.assertRaisesRegex(ValueError, 'rejected'):
                    with protect(out):
                        html.write_bytes(b'upstream replacement')
                        raise ValueError('new universe rejected')
                self.assertTrue((out / '.graph.html.stale').exists())
                if had_previous:
                    self.assertEqual(html.read_bytes(), b'previous universe')
                else:
                    self.assertFalse(html.exists())

    def test_successful_cluster_and_export_keeps_new_html(self):
        build = runpy.run_path(str(SCRIPTS / 'build-local.py'))
        protect = build.get('preserve_html')
        self.assertIsNotNone(protect, 'The entire cluster/export sequence must preserve previous HTML')
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            html = out / 'graph.html'
            html.write_bytes(b'previous universe')
            with protect(out):
                html.write_bytes(b'new universe')
            self.assertEqual(html.read_bytes(), b'new universe')


if __name__ == '__main__':
    unittest.main()
