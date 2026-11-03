"""Exercise graph source and vault boundaries with synthetic files only."""
import contextlib
import builtins
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent


@contextlib.contextmanager
def working_directory(path):
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def load(self, name):
        with working_directory(self.root):
            return runpy.run_path(str(SCRIPTS / name))

    def test_build_uses_source_worktree_not_script_checkout(self):
        build = self.load('build-local.py')
        self.assertEqual(build['ROOT'], self.root)
        self.assertEqual(build['OUT'], self.root / 'graphify-out')

    def test_optimized_execution_refuses_before_loading_setup(self):
        for name in ('build-local.py', 'stage-export.py'):
            with self.subTest(script=name):
                result = subprocess.run([
                    sys.executable, '-B', '-O', '-c',
                    'import runpy,sys; runpy.run_path(sys.argv[1])', str(SCRIPTS / name),
                ], cwd=self.root, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Optimized Python is unsupported', result.stderr)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_cli_disables_auto_refresh_even_if_parent_enables_it(self):
        package = self.root / 'graphify'
        package.mkdir()
        (package / '__init__.py').write_text('')
        (package / '__main__.py').write_text(
            'import os\nfrom pathlib import Path\n'
            'if os.environ.get("GRAPHIFY_NO_AUTO_REFRESH") != "1":\n'
            '    Path("unwanted-skill-refresh").touch()\n'
        )
        with patch.dict(os.environ, {'PYTHONPATH': str(self.root), 'GRAPHIFY_NO_AUTO_REFRESH': '0'}):
            build = self.load('build-local.py')
            build['run_graphify']('query', 'synthetic')
        self.assertFalse((self.root / 'unwanted-skill-refresh').exists())

    def test_cli_output_override_stays_in_source_checkout(self):
        package = self.root / 'graphify'
        package.mkdir()
        (package / '__init__.py').write_text('')
        (package / '__main__.py').write_text(
            'import os\nfrom pathlib import Path\n'
            'Path("chosen-output.txt").write_text(os.environ.get("GRAPHIFY_OUT", ""))\n'
        )
        with patch.dict(os.environ, {'PYTHONPATH': str(self.root), 'GRAPHIFY_OUT': str(self.root / 'elsewhere')}):
            self.load('build-local.py')['run_graphify']('query', 'synthetic')
        self.assertEqual((self.root / 'chosen-output.txt').read_text(), str(self.root / 'graphify-out'))

    def test_output_is_pinned_before_first_parser_import(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        (self.root / 'src').mkdir()
        (self.root / 'src/example.ts').write_text('export function sample() { return 1; }')
        original_import = builtins.__import__
        observed = []

        def observe(name, *args, **kwargs):
            if name.startswith('graphify'):
                observed.append(os.environ.get('GRAPHIFY_OUT'))
            return original_import(name, *args, **kwargs)

        with patch.dict(os.environ, {'GRAPHIFY_OUT': str(self.root / 'elsewhere')}):
            build = self.load('build-local.py')
            with patch('builtins.__import__', side_effect=observe):
                build['corpus']()
        self.assertTrue(observed)
        self.assertTrue(all(value == str(self.root / 'graphify-out') for value in observed))

    def export(self):
        export = self.load('stage-export.py')
        trial = self.root / 'graphify-out/trial'
        trial.mkdir(parents=True)
        (trial / 'build-metadata.json').write_text(json.dumps({
            'source_commit': 'a' * 40, 'build_date': '2026-11-03', 'version': '0.9.90',
        }), encoding='utf-8')
        (trial.parent / 'GRAPH_REPORT.md').write_text('Source commit: ' + 'a' * 40, encoding='utf-8')
        (trial.parent / 'graph.html').write_text('<html>synthetic graph</html>', encoding='utf-8')
        self.vault = self.root / 'vault'
        self.vault.mkdir()
        self.env = patch.dict(os.environ, {'WOLF_FORGE_OBSIDIAN_VAULT_PATH': str(self.vault)})
        self.env.start()
        self.addCleanup(self.env.stop)
        return export

    def test_preview_has_three_files_and_does_not_write_vault(self):
        export = self.export()
        export['preview']()
        self.assertEqual(list(self.vault.iterdir()), [])
        rows = json.loads((self.root / 'graphify-out/trial/external-files.json').read_text())
        self.assertEqual({Path(r['target']).name for r in rows}, {'GRAPH_REPORT.md', 'README.md', 'graph.html'})

    def test_stale_html_is_omitted_from_preview(self):
        export = self.export()
        (self.root / 'graphify-out/.graph.html.stale').write_text('Visualization failed')
        export['preview']()
        rows = json.loads((self.root / 'graphify-out/trial/external-files.json').read_text())
        self.assertEqual({Path(r['target']).name for r in rows}, {'GRAPH_REPORT.md', 'README.md'})
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_missing_html_still_stages_markdown(self):
        export = self.export()
        (self.root / 'graphify-out/graph.html').unlink()
        export['preview']()
        rows = json.loads((self.root / 'graphify-out/trial/external-files.json').read_text())
        self.assertEqual({Path(r['target']).name for r in rows}, {'GRAPH_REPORT.md', 'README.md'})
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_changed_destination_refuses_entire_copy(self):
        export = self.export()
        export['preview']()
        target = self.vault / '02 Projects/Wolf Forge Platform/Code Graph'
        target.mkdir(parents=True)
        (target / 'README.md').write_text('Changed after review', encoding='utf-8')
        with self.assertRaisesRegex((AssertionError, RuntimeError), 'target changed'):
            export['copy_reviewed']()
        self.assertEqual({p.name for p in target.iterdir()}, {'README.md'})

    def test_changed_staged_source_refuses_copy(self):
        export = self.export()
        export['preview']()
        (self.root / 'graphify-out/trial/vault-preview/README.md').write_text('Changed after review')
        with self.assertRaisesRegex((AssertionError, RuntimeError), 'source changed'):
            export['copy_reviewed']()
        self.assertEqual(list(self.vault.iterdir()), [])

    def test_copy_preserves_unrelated_notes_and_verifies_bytes(self):
        export = self.export()
        export['preview']()
        target = self.vault / '02 Projects/Wolf Forge Platform/Code Graph'
        target.mkdir(parents=True)
        (target / 'owner-note.md').write_text('Keep me')
        export['copy_reviewed']()
        self.assertEqual((target / 'owner-note.md').read_text(), 'Keep me')
        rows = json.loads((self.root / 'graphify-out/trial/external-files.json').read_text())
        for row in rows:
            self.assertEqual(hashlib.sha256(Path(row['target']).read_bytes()).hexdigest(), row['after_sha256'])


if __name__ == '__main__':
    unittest.main()
