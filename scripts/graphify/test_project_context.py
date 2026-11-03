"""Bounded read-only context tests; never the real vault."""
import json
import io
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent


class ContextTests(unittest.TestCase):
    def setUp(self):
        module = SCRIPTS / 'project-context.py'
        self.assertTrue(module.exists(), 'Payments context is not implemented')
        self.api = runpy.run_path(str(module))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.vault = Path(self.temp.name).resolve() / 'vault'
        self.memory = self.vault / '02 Projects/Wolf Forge Platform/AI Memory'
        self.memory.mkdir(parents=True)
        self.names = self.api['NOTE_FILES']
        for name in self.names:
            (self.memory / name).write_text('# ' + name + '\n\n## Payments decision\nPRIVATE PARAGRAPH MUST STAY IN OBSIDIAN\n`src/domain/invoices/manual-payments.ts`\n', encoding='utf-8')
        self.nodes = [['helper','src/lib/format.ts','','Shared','','symbol','helper'],
                      ['manual-payments.ts','src/domain/invoices/manual-payments.ts','','Domain','','module','module'],
                      ['settle','src/domain/invoices/manual-payments.ts','','Domain','','symbol','settle'],
                      ['test','src/tests/invoice-manual-payments.test.ts','','Tests','','module','test']]
        self.index = self.api['NotesIndex'](self.memory,self.vault)

    def test_focus_is_path_based_and_excludes_unrelated_or_unsafe_paths(self):
        nodes = self.nodes + [['payment','src/components/avatar.tsx','','','','','x'],
                              ['bad','../payments.ts','','','','','bad'],
                              ['bad','C:/wallet.ts','','','','','abs']]
        self.assertEqual(self.api['payment_indices'](nodes), [1,2,3])

    def test_only_allowlisted_metadata_and_exact_graph_references_are_returned(self):
        (self.memory / 'Raw').mkdir()
        (self.memory / 'Raw/private.md').write_text('# SECRET RAW',encoding='utf-8')
        (self.memory / '03 Implementation Log.md').write_text('# SECRET LOG',encoding='utf-8')
        before = {p:p.read_bytes() for p in self.memory.rglob('*.md')}
        result = self.index.snapshot(self.nodes)
        text = json.dumps(result)
        self.assertEqual(len(result['notes']),5)
        self.assertNotIn('PRIVATE PARAGRAPH',text)
        self.assertNotIn('SECRET RAW',text)
        self.assertNotIn('SECRET LOG',text)
        self.assertEqual({p:p.read_bytes() for p in before},before)
        self.assertTrue(all(link[1] == 1 for link in result['links']))
        self.assertTrue(all(note['payment'] for note in result['notes']))
        self.assertTrue(all(note['uri'].startswith('obsidian://open?') for note in result['notes']))
        self.assertNotIn('append=',text)
        self.assertNotIn('content=',text)

    def test_headings_and_explicit_paths_match_without_body_keyword_inference(self):
        p=self.memory/self.names[0]
        p.write_text('# Brain\n## General\nPayment body prose only\n## Linked\n`src/domain/invoices/manual-payments.ts`\n## Wallet policy\nNo explicit path\n',encoding='utf-8')
        note=self.index.snapshot(self.nodes)['notes'][0]
        self.assertEqual([s['title'] for s in note['sections']],['Linked','Wallet policy'])

    def test_fenced_code_does_not_invent_headings_or_references(self):
        (self.memory/self.names[0]).write_text('# Brain\n```md\n## Wallet fake\n`src/domain/invoices/manual-payments.ts`\n```\n## Ordinary\n',encoding='utf-8')
        self.assertFalse(self.index.snapshot(self.nodes)['notes'][0]['payment'])
        (self.memory/self.names[0]).write_text('# Brain\n````md\n```\n## Wallet fake\n`src/domain/invoices/manual-payments.ts`\n````\n## Ordinary\n',encoding='utf-8')
        self.assertFalse(self.index.snapshot(self.nodes)['notes'][0]['payment'])

    def test_missing_and_oversize_notes_leave_partial_metadata_without_unsafe_uri(self):
        (self.memory/self.names[0]).unlink()
        (self.memory/self.names[1]).write_bytes(b'x' * 2_000_001)
        result=self.index.snapshot(self.nodes)
        self.assertEqual(result['status'],'partial')
        self.assertEqual(len(result['notes']),3)
        self.assertNotIn(self.names[0],[n['file'] for n in result['notes']])

    def test_wrong_memory_binding_is_rejected(self):
        with self.assertRaises(ValueError):
            self.api['NotesIndex'](self.vault/'other',self.vault)

    def test_redirected_file_is_removed_even_after_a_cached_read(self):
        self.index.snapshot(self.nodes)
        original=Path.is_symlink
        target=self.memory/self.names[0]
        def redirected(path): return path == target or original(path)
        with patch.object(Path,'is_symlink',redirected):
            result=self.index.snapshot(self.nodes)
        self.assertEqual(len(result['notes']),4)

    def test_note_edits_change_metadata_and_limits_are_visible(self):
        before=self.index.snapshot(self.nodes)
        p=self.memory/self.names[0]
        p.write_text('# Brain edited\n'+''.join('## Wallet '+str(i)+'\n' for i in range(40)),encoding='utf-8')
        after=self.index.snapshot(self.nodes)
        self.assertNotEqual(before,after)
        self.assertEqual(len(after['notes'][0]['sections']),24)
        self.assertEqual(after['notes'][0]['section_count'],40)
        p.write_text('# Brain\n## Wallet '+('X'*200)+'\n',encoding='utf-8')
        section=self.index.snapshot(self.nodes)['notes'][0]['sections'][0]
        self.assertEqual(len(section['title']),180)
        self.assertTrue(section['truncated'])

    def test_file_references_are_capped_per_note(self):
        paths=['src/payments/file'+str(i)+'.ts' for i in range(45)]
        nodes=[[str(i),path,'','Domain','','module',str(i)] for i,path in enumerate(paths)]
        (self.memory/self.names[0]).write_text('# Brain\n## Payments\n'+'\n'.join('`'+p+'`' for p in paths),encoding='utf-8')
        result=self.index.snapshot(nodes)
        self.assertEqual(sum(link[0]==0 for link in result['links']),30)
        self.assertEqual(result['notes'][0]['reference_count'],45)

    def test_concurrent_growth_cannot_request_an_unbounded_read(self):
        target=self.memory/self.names[0]
        limit=self.api['MAX_BYTES']
        original=Path.open
        class BoundedStream(io.BytesIO):
            def read(self,size=-1):
                if size<0 or size>limit+1:
                    raise AssertionError('Unbounded note read')
                return super().read(size)
        def opened(path,*args,**kwargs):
            if path==target:
                return BoundedStream(b'x'*(limit+1))
            return original(path,*args,**kwargs)
        with patch.object(Path,'open',opened):
            result=self.index.snapshot(self.nodes)
        self.assertEqual(len(result['notes']),4)


if __name__ == '__main__':
    unittest.main()
