"""Real temporary-file publication tests; GitHub responses are synthetic."""
import copy
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('refresh-after-merge.py')
OLD, NEW = 'a' * 40, 'b' * 40
JOBS = ['static lint boundary', 'TypeScript compile boundary', 'compiled app and PDF font trace',
        'JavaScript and TypeScript tests', 'local Supabase pgTAP and RLS tests',
        'production dependency vulnerabilities', 'repository and history secret scan']
REPO = 'UplineTonyuo/wolf-forge-platform'


class FakeAPI:
    def __init__(self):
        self.run = dict(id=123, head_sha=NEW, head_branch='main', event='push', path='.github/workflows/security.yml',
                        status='completed', conclusion='success', run_attempt=1, created_at='2026-11-04T01:00:00Z')
        self.runs = [self.run]
        self.jobs = [dict(name=n, status='completed', conclusion='success') for n in JOBS]
        self.statuses = [dict(id=3, context='Vercel', state='success', created_at='2026-11-04T01:00:00Z')]
        self.prs = [dict(number=110, merged_at='2026-11-04T00:59:00Z', merge_commit_sha=NEW,
                         base=dict(ref='main', repo=dict(full_name=REPO)))]
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        if path == '/git/ref/heads/main':
            return {'object': {'sha': NEW}}
        if path == '/actions/runs/123':
            return copy.deepcopy(self.run)
        if path.startswith('/pulls/'):
            return {**copy.deepcopy(self.prs[0]), 'merged': bool(self.prs[0]['merged_at'])}
        raise AssertionError(path)

    def pages(self, path, key=None):
        self.calls.append(path)
        if path.startswith('/actions/workflows/security.yml/runs?'):
            return copy.deepcopy(self.runs)
        if path.startswith('/actions/runs/123/jobs?'):
            return copy.deepcopy(self.jobs)
        if path == f'/commits/{NEW}/statuses':
            return copy.deepcopy(self.statuses)
        if path == f'/commits/{NEW}/pulls':
            return copy.deepcopy(self.prs)
        raise AssertionError(path)


class AutomationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'verified-merge runner has not been implemented')
        self.m = runpy.run_path(str(SCRIPT))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.vault = self.root / 'vault'
        self.memory = self.vault / '02 Projects/Wolf Forge Platform/AI Memory'
        self.exports = self.memory.parent / 'Code Graph'
        self.memory.mkdir(parents=True)
        self.exports.mkdir()
        self.runtime = self.root / 'graph/graphify-out/automation'
        self.runtime.mkdir(parents=True)
        self.config = dict(graph_root=str(self.root / 'graph'), vault=str(self.vault), memory=str(self.memory),
                           runtime=str(self.runtime), repository=REPO)
        self.before_log = b'# Existing history\r\n\r\nUnrelated original bytes.\r\n'
        self.log = self.memory / '03 Implementation Log.md'
        self.log.write_bytes(self.before_log)
        self.stage = self.root / 'stage'
        self.stage.mkdir()
        self.hashes = {}
        for name in ('GRAPH_REPORT.md', 'README.md', 'graph.html'):
            old = f'old {name}'.encode()
            (self.exports / name).write_bytes(old)
            self.hashes[name] = hashlib.sha256(old).hexdigest()
            (self.stage / name).write_bytes(f'new {name} source {NEW}'.encode())
        (self.exports / 'unrelated.md').write_bytes(b'preserve me')
        self.state = dict(published_sha=OLD, export_hashes=self.hashes)
        self.m['atomic_json'](self.runtime / 'state.json', self.state)
        self.evidence = dict(sha=NEW, run_id=123, run_attempt=1, prs=[110], verified_at='2026-11-04T01:00:00Z')
        self.meta = dict(source_commit=NEW, version='0.9.90', input_tokens=0, output_tokens=0, files=2, nodes=3, edges=4)

    def test_exact_sha_complete_gates_authorize(self):
        result = self.m['verified_snapshot'](FakeAPI(), NEW)
        self.assertEqual((result['sha'], result['run_id'], result['prs']), (NEW, 123, [110]))

    def test_pr_summary_without_merge_sha_uses_full_pr_evidence(self):
        api = FakeAPI()
        detail = {**copy.deepcopy(api.prs[0]), 'merged': True}
        del api.prs[0]['merge_commit_sha']
        original = api.get
        api.get = lambda path: detail if path == '/pulls/110' else original(path)
        self.assertEqual(self.m['verified_snapshot'](api, NEW)['prs'], [110])

    def test_wrong_sha_event_branch_and_path_refused(self):
        for field, value in [('head_sha', OLD), ('event', 'pull_request'), ('head_branch', 'feature'), ('path', 'other.yml')]:
            with self.subTest(field=field):
                api = FakeAPI()
                api.run[field] = value
                with self.assertRaises(self.m['Pending']):
                    self.m['verified_snapshot'](api, NEW)

    def test_newer_pending_or_failed_run_overrides_old_success(self):
        for status, conclusion in [('in_progress', None), ('completed', 'failure'), ('completed', 'cancelled')]:
            api = FakeAPI()
            api.runs.append(dict(api.run, id=124, created_at='2026-11-04T02:00:00Z', status=status, conclusion=conclusion))
            with self.assertRaises(self.m['Pending']):
                self.m['verified_snapshot'](api, NEW)

    def test_missing_skipped_and_duplicate_jobs_refused(self):
        for mode in ('missing', 'skipped', 'duplicate'):
            api = FakeAPI()
            if mode == 'missing':
                api.jobs.pop()
            elif mode == 'skipped':
                api.jobs[0]['conclusion'] = 'skipped'
            else:
                api.jobs.append(api.jobs[0])
            with self.assertRaises(self.m['Pending']):
                self.m['verified_snapshot'](api, NEW)

    def test_direct_push_and_wrong_base_pr_refused(self):
        for mode in ('none', 'wrong_base', 'unmerged'):
            api = FakeAPI()
            if mode == 'none':
                api.prs.clear()
            elif mode == 'wrong_base':
                api.prs[0]['base']['ref'] = 'other'
            else:
                api.prs[0]['merged_at'] = None
            with self.assertRaises(self.m['Pending']):
                self.m['verified_snapshot'](api, NEW)

    def test_latest_vercel_failure_or_pending_refused(self):
        for state in ('failure', 'pending'):
            api = FakeAPI()
            api.statuses.append(dict(id=4, context='Vercel', state=state, created_at='2026-11-04T02:00:00Z'))
            with self.assertRaises(self.m['Pending']):
                self.m['verified_snapshot'](api, NEW)

    def test_authentication_failure_does_not_reveal_credential(self):
        with patch('subprocess.run') as child:
            child.return_value.returncode = 1
            child.return_value.stdout = b'password=do-not-print-this-value\n'
            with self.assertRaisesRegex(RuntimeError, '^GitHub credential unavailable$'):
                self.m['credential']('git')

    def test_bindings_refuse_changed_environment_and_redirected_memory(self):
        env = {'WOLF_FORGE_OBSIDIAN_VAULT_PATH': str(self.vault), 'WOLF_FORGE_OBSIDIAN_MEMORY_PATH': str(self.memory)}
        with patch.dict(os.environ, env):
            self.m['validate_bindings'](self.config)
            self.config['memory'] = str(self.root)
            with self.assertRaises(RuntimeError):
                self.m['validate_bindings'](self.config)
        self.config['memory'] = str(self.memory)
        with patch.dict(os.environ, {**env, 'WOLF_FORGE_OBSIDIAN_VAULT_PATH': str(self.root)}):
            with self.assertRaises(RuntimeError):
                self.m['validate_bindings'](self.config)

    def test_exclusive_lock_prevents_other_writer(self):
        with self.m['exclusive_file'](self.log):
            with self.assertRaises(self.m['Busy']):
                with self.m['exclusive_file'](self.log):
                    self.fail('second writer acquired the same file')

    def test_publish_and_repeat_preserve_history_and_unrelated_file(self):
        for _ in range(2):
            self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        log = self.log.read_bytes()
        self.assertTrue(log.startswith(self.before_log))
        self.assertEqual(log.count(f'wolf-forge-graphify-merge:{NEW}'.encode()), 1)
        self.assertEqual((self.exports / 'unrelated.md').read_bytes(), b'preserve me')
        for name in self.hashes:
            self.assertEqual((self.exports / name).read_bytes(), (self.stage / name).read_bytes())
        self.assertEqual(json.loads((self.runtime / 'state.json').read_text())['published_sha'], NEW)

    def test_changed_export_is_not_overwritten(self):
        (self.exports / 'README.md').write_bytes(b'owner edited this')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        self.assertEqual(self.log.read_bytes(), self.before_log)
        self.assertEqual((self.exports / 'README.md').read_bytes(), b'owner edited this')

    def test_stale_missing_or_oversize_html_prevents_entire_publication(self):
        html = self.stage / 'graph.html'
        html.unlink()
        with self.assertRaises(RuntimeError):
            self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        html.write_bytes(b'x' * 10_000_000)
        with self.assertRaises(RuntimeError):
            self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        self.assertEqual(self.log.read_bytes(), self.before_log)

    def test_model_tokens_or_wrong_build_sha_refused(self):
        for field, value in [('source_commit', OLD), ('input_tokens', 1), ('version', 'other')]:
            with self.assertRaises(RuntimeError):
                self.m['publish'](self.config, self.evidence, {**self.meta, field: value}, self.stage)

    def test_crash_mid_export_resumes_and_appends_once(self):
        real = self.m['write_handle']
        count = 0

        def interrupted(handle, data):
            nonlocal count
            count += 1
            if count == 1:
                handle.seek(0)
                handle.write(data[:7])
                handle.flush()
                raise OSError('simulated power loss')
            return real(handle, data)

        with patch.dict(self.m['publish'].__globals__, {'write_handle': interrupted}):
            with self.assertRaises(OSError):
                self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        self.m['recover'](self.config)
        self.assertEqual(self.log.read_bytes().count(f'wolf-forge-graphify-merge:{NEW}'.encode()), 1)
        self.assertEqual((self.exports / 'GRAPH_REPORT.md').read_bytes(), (self.stage / 'GRAPH_REPORT.md').read_bytes())

    def test_crash_mid_log_preserves_prefix_and_completes_once(self):
        real = self.m['append_handle']

        def interrupted(handle, data):
            handle.seek(0, 2)
            handle.write(data[:13])
            handle.flush()
            raise OSError('simulated power loss')

        with patch.dict(self.m['publish'].__globals__, {'append_handle': interrupted}):
            with self.assertRaises(OSError):
                self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        self.m['recover'](self.config)
        log = self.log.read_bytes()
        self.assertTrue(log.startswith(self.before_log))
        self.assertEqual(log.count(f'wolf-forge-graphify-merge:{NEW}'.encode()), 1)

    def test_interrupted_transaction_preserves_later_complete_log_append(self):
        with patch.dict(self.m['publish'].__globals__, {'write_handle': lambda *a: (_ for _ in ()).throw(OSError())}):
            with self.assertRaises(OSError):
                self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        with self.log.open('ab') as stream:
            stream.write(b'\r\nAnother steward appended this.\r\n')
        self.m['recover'](self.config)
        self.assertIn(b'Another steward appended this.', self.log.read_bytes())

    def test_unchanged_poll_never_builds_or_fetches(self):
        self.state['published_sha'] = NEW
        self.m['atomic_json'](self.runtime / 'state.json', self.state)
        with patch.dict(self.m['run'].__globals__, {'GitHub': lambda cfg: FakeAPI(), 'validate_checkout': lambda cfg: None,
                                                   'validate_program': lambda cfg: None, 'validate_bindings': lambda cfg: None,
                                                   'build_snapshot': lambda *args: self.fail('unchanged poll rebuilt')}):
            self.assertEqual(self.m['run'](self.config), 'unchanged')

    def test_crash_after_checkpoint_before_journal_cleanup_recovers(self):
        with patch.dict(self.m['publish'].__globals__, {'clear_pending': lambda *a: (_ for _ in ()).throw(OSError())}):
            with self.assertRaises(OSError):
                self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        (self.runtime / 'pending-GRAPH_REPORT.md.before').unlink()
        self.m['recover'](self.config)
        self.assertFalse((self.runtime / 'pending.json').exists())
        self.assertEqual(self.log.read_bytes().count(f'wolf-forge-graphify-merge:{NEW}'.encode()), 1)

    def test_dirty_checkout_is_refused(self):
        def fake_git(config, *args, **kwargs):
            if args[:2] == ('rev-parse', '--show-toplevel'):
                return config['graph_root']
            if args[:3] == ('remote', 'get-url', 'origin'):
                return self.m['REMOTE']
            if args[0] == 'symbolic-ref':
                return ''
            if args[0] == 'status':
                return '?? src/unsaved.ts'
            self.fail(args)
        with patch.dict(self.m['validate_checkout'].__globals__, {'git': fake_git}):
            with self.assertRaisesRegex(RuntimeError, 'clean'):
                self.m['validate_checkout'](self.config)

    def test_api_unavailable_preserves_all_vault_files(self):
        before = {path: path.read_bytes() for path in self.exports.iterdir()}
        with patch.dict(self.m['run'].__globals__, {'validate_checkout': lambda cfg: None, 'validate_program': lambda cfg: None,
                                                   'validate_bindings': lambda cfg: None, 'GitHub': lambda cfg: (_ for _ in ()).throw(RuntimeError('offline'))}):
            with self.assertRaisesRegex(RuntimeError, 'offline'):
                self.m['run'](self.config)
        self.assertEqual(self.log.read_bytes(), self.before_log)
        self.assertEqual({path: path.read_bytes() for path in self.exports.iterdir()}, before)

    def test_pending_evidence_does_not_start_build(self):
        api = FakeAPI()
        api.run['conclusion'] = 'failure'
        with patch.dict(self.m['run'].__globals__, {'validate_checkout': lambda cfg: None, 'validate_program': lambda cfg: None,
                                                   'validate_bindings': lambda cfg: None, 'GitHub': lambda cfg: api,
                                                   'build_snapshot': lambda *a: self.fail('built without passing gates')}):
            with self.assertRaises(self.m['Pending']):
                self.m['run'](self.config)

    def test_offline_catch_up_covers_merged_prs_once(self):
        class History:
            def pages(inner, path, key=None):
                commit = path.split('/')[2]
                if commit == 'c' * 40:
                    return []  # A direct push is covered by later CI, never called a merged PR.
                return [dict(number=110 if commit == NEW else 111, merged_at='2026-11-04T01:00:00Z',
                             merge_commit_sha=commit, base=dict(ref='main', repo=dict(full_name=REPO)))]
            def get(inner, path):
                commit = NEW if path == '/pulls/110' else 'd' * 40
                return {**inner.pages(f'/commits/{commit}/pulls')[0], 'merged': True}
        self.assertEqual(self.m['covered_prs'](History(), [NEW, 'c' * 40, 'd' * 40], [110]), [110, 111])
        with self.assertRaisesRegex(RuntimeError, '100'):
            self.m['covered_prs'](History(), [NEW] * 101, [110])

    def test_changed_installed_program_refused(self):
        self.config['program_hashes'] = {}
        for name in self.m['PROGRAM_FILES']:
            path = self.runtime / 'program' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'reviewed program')
            self.config['program_hashes'][name] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.m['validate_program'](self.config)
        path.write_bytes(b'unreviewed replacement')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.m['validate_program'](self.config)

    def test_latest_run_attempt_change_refused(self):
        api = FakeAPI()
        original = api.get
        calls = 0
        def changing(path):
            nonlocal calls
            result = original(path)
            calls += 1
            if calls == 2:
                result['run_attempt'] = 2
            return result
        api.get = changing
        with self.assertRaisesRegex(self.m['Pending'], 'changed'):
            self.m['verified_snapshot'](api, NEW)

    def test_partial_log_followed_by_conflicting_content_is_preserved(self):
        def interrupted(handle, data):
            handle.seek(0, 2)
            handle.write(data[:13])
            raise OSError()
        with patch.dict(self.m['publish'].__globals__, {'append_handle': interrupted}):
            with self.assertRaises(OSError):
                self.m['publish'](self.config, self.evidence, self.meta, self.stage)
        with self.log.open('ab') as stream:
            stream.write(b'steward wrote here')
        before = self.log.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'conflict'):
            self.m['recover'](self.config)
        self.assertEqual(self.log.read_bytes(), before)

    def test_incoming_tree_cannot_overwrite_ignored_runtime(self):
        graph = Path(self.config['graph_root'])
        self.config['git'] = 'git'
        def git(*args):
            result = subprocess.run(['git', '-C', str(graph), *args], check=True, capture_output=True, text=True)
            return result.stdout.strip()
        git('init', '--quiet')
        git('config', 'user.name', 'Boundary Test')
        git('config', 'user.email', 'boundary@example.invalid')
        git('remote', 'add', 'origin', self.m['REMOTE'])
        (graph / '.gitignore').write_text('/graphify-out/\n')
        git('add', '.gitignore')
        git('commit', '--quiet', '-m', 'baseline')
        baseline = git('rev-parse', 'HEAD')
        frozen = self.runtime / 'program/scripts/graphify/build-local.py'
        frozen.parent.mkdir(parents=True)
        frozen.write_bytes(b'incoming checkout code')
        git('add', '-f', 'graphify-out/automation/program/scripts/graphify/build-local.py')
        git('commit', '--quiet', '-m', 'attempt runtime overwrite')
        incoming = git('rev-parse', 'HEAD')
        git('switch', '--detach', baseline)
        frozen.parent.mkdir(parents=True, exist_ok=True)
        frozen.write_bytes(b'reviewed frozen program')
        with self.assertRaisesRegex(RuntimeError, 'reserved'):
            self.m['prepare_checkout'](self.config, incoming)
        self.assertEqual(frozen.read_bytes(), b'reviewed frozen program')
        self.assertEqual(git('rev-parse', 'HEAD'), baseline)


if __name__ == '__main__':
    unittest.main()
