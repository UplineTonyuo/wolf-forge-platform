"""Deterministic payment paths and read-only metadata from five canonical notes."""
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import re
from urllib.parse import quote, urlencode

NOTE_FILES = ('00 Project Brain.md','01 Current State.md','02 Decisions.md',
              '04 Known Issues.md','05 Architecture Map.md')
PAYMENT = re.compile(r'(?<![a-z])(?:invoices?|payments?|wallets?|refunds?|billing|stripe|money|wf[-_]?card)(?![a-z])',re.I)
ROOTS = {'src','supabase','tests','scripts','docs'}
MAX_BYTES = 2_000_000


def repo_path(value):
    if not isinstance(value,str) or len(value)>240:
        return None
    value=re.sub(r'(?::L?\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$','',value.strip())
    path=PurePosixPath(value)
    if (not value or '\\' in value or ':' in value or '?' in value or '#' in value
            or any(ord(c)<32 for c in value) or path.is_absolute() or '..' in path.parts
            or not path.parts or path.parts[0] not in ROOTS or str(path)!=value
            or any(p.startswith('.env') for p in path.parts)):
        return None
    return value


def payment_indices(nodes):
    return [i for i,n in enumerate(nodes) if repo_path(n[1]) and PAYMENT.search(n[1])]


def plain(path,root):
    path,root=Path(path).absolute(),Path(root).absolute()
    if not path.is_relative_to(root) or path.resolve()!=path:
        raise ValueError('Redirected project note')
    cursor=path
    while cursor.is_relative_to(root):
        if cursor.is_symlink() or (hasattr(cursor,'is_junction') and cursor.is_junction()):
            raise ValueError('Redirected project note')
        if cursor==root:
            break
        cursor=cursor.parent
    return path


def clean_title(value):
    return re.sub(r'[\x00-\x1f\x7f]',' ',value).strip()[:180]


def parse_note(text,name):
    title=name[:-3]
    sections=[]
    section={'title':title,'line':1,'paths':[]}
    fence=None
    for number,line in enumerate(text.splitlines(),1):
        marker=re.match(r'^\s*(`{3,}|~{3,})(.*)$',line)
        if marker:
            char=marker[1][0]
            if fence is None:
                fence=(char,len(marker[1]))
            elif fence[0]==char and len(marker[1])>=fence[1] and not marker[2].strip():
                fence=None
            continue
        if fence:
            continue
        heading=re.match(r'^(#{1,6})\s+(.+?)\s*#*\s*$',line)
        if heading:
            sections.append(section)
            label=clean_title(heading[2])
            if len(heading[1])==1 and title==name[:-3]:
                title=label
            section={'title':label,'line':number,'paths':[]}
        for mention in re.findall(r'`([^`\r\n]{1,260})`',line):
            path=repo_path(mention)
            if path and path not in section['paths']:
                section['paths'].append(path)
    sections.append(section)
    matched=[s for s in sections if PAYMENT.search(s['title']) or any(PAYMENT.search(p) for p in s['paths'])]
    selected=matched[:24]
    references=list(dict.fromkeys(p for section in selected for p in section['paths']))
    headings=[{'title':section['title'],'line':section['line']} for section in selected]
    return {'title':clean_title(title),'sections':headings,'paths':references[:30],
            'reference_count':len(references),'section_count':len(matched),'payment':bool(matched)}


class NotesIndex:
    def __init__(self,memory,vault):
        self.vault=Path(vault).absolute()
        self.memory=Path(memory).absolute()
        if self.memory!=self.vault/'02 Projects/Wolf Forge Platform/AI Memory':
            raise ValueError('Unexpected canonical memory path')
        plain(self.memory,self.vault)
        self.cache={}
        self.code_nodes=None
        self.code_paths={}

    def snapshot(self,nodes):
        if self.code_nodes is not nodes:
            self.code_nodes=nodes
            self.code_paths={}
            for i,node in enumerate(nodes):
                path=repo_path(node[1])
                if path and (path not in self.code_paths or node[5]=='module'):
                    self.code_paths[path]=i
        notes=[]
        links=[]
        for name in NOTE_FILES:
            path=self.memory/name
            try:
                plain(path,self.vault)
                before=path.stat()
                if not path.is_file() or before.st_size>MAX_BYTES:
                    raise ValueError('Unsupported note')
                signature=(before.st_mtime_ns,before.st_ctime_ns,before.st_size,before.st_ino)
                cached=self.cache.get(name)
                if cached and cached[0]==signature:
                    parsed=cached[1]
                else:
                    with path.open('rb') as stream:
                        content=stream.read(MAX_BYTES+1)
                    after=path.stat()
                    if (len(content)>MAX_BYTES or signature!=(after.st_mtime_ns,after.st_ctime_ns,after.st_size,after.st_ino)):
                        raise ValueError('Note changed while indexing')
                    plain(path,self.vault)
                    parsed=parse_note(content.decode('utf-8-sig'),name)
                    self.cache[name]=(signature,parsed)
                entry={**{k:v for k,v in parsed.items() if k!='paths'},'id':'note:'+name,'file':name,'path':'AI Memory/'+name,
                       'uri':'obsidian://open?'+urlencode({'path':str(path),'paneType':'tab'},quote_via=quote),
                       'modified':datetime.fromtimestamp(before.st_mtime,timezone.utc).isoformat()}
                references=parsed['paths']
                for source in references:
                    if source in self.code_paths:
                        links.append([len(notes),self.code_paths[source],'mentions file'])
                entry['unresolved_count']=sum(p not in self.code_paths for p in references)
                notes.append(entry)
            except (OSError,ValueError,UnicodeError):
                self.cache.pop(name,None)
        status='ready' if len(notes)==len(NOTE_FILES) else 'partial' if notes else 'unavailable'
        return {'available':bool(notes),'status':status,'notes':notes,'links':links,
                'message':f'{len(notes)} of {len(NOTE_FILES)} curated project notes · read-only'}
