"""Render the existing Graphify snapshot as an offline, self-contained universe."""
from __future__ import annotations

if not __debug__:
    raise RuntimeError('Optimized Python is unsupported')

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile

TEMPLATE = Path(__file__).with_name('universe.html')
MAX_HTML_BYTES = 9_990_000  # Leave space for the publisher's provenance header.


def text(value, maximum=1000):
    if not isinstance(value, str) or len(value) > maximum or '\x00' in value:
        raise ValueError('Invalid graph text field')
    return value


def source_group(path):
    if path.startswith('src/components/'): return 'Components'
    if path.startswith(('src/app/', 'src/services/')): return 'Application'
    if path.startswith(('src/repositories/', 'src/lib/supabase/')): return 'Data'
    if path.startswith('src/domain/'): return 'Domain'
    if path.startswith('supabase/'): return 'Database'
    if path.startswith(('src/tests/', 'tests/')): return 'Tests'
    if path.startswith('scripts/'): return 'Scripts'
    if path.startswith('docs/'): return 'Docs'
    return 'Shared' if path else 'External'


def build_payload(graph, metadata):
    sha = metadata.get('source_commit')
    if (not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{40}', sha)
            or graph.get('built_at_commit') != sha
            or metadata.get('version') != '0.9.90'
            or graph.get('graph', {}).get('graphify_version') != '0.9.90'):
        raise ValueError('Graph snapshot SHA/version mismatch')
    nodes, edges = graph.get('nodes'), graph.get('links', graph.get('edges'))
    if not isinstance(nodes, list) or not isinstance(edges, list) or len(nodes) > 250_000 or len(edges) > 1_000_000:
        raise ValueError('Invalid graph size or shape')
    if (type(metadata.get('files')) is not int or metadata['files'] < 0
            or metadata.get('nodes') != len(nodes) or metadata.get('edges') != len(edges)):
        raise ValueError('Graph snapshot counts mismatch')
    index, compact = {}, []
    for node in nodes:
        node_id = text(node['id'], 2000)
        if node_id in index:
            raise ValueError('Duplicate graph node')
        path = text(node.get('source_file', '')).replace('\\', '/')
        if node.get('type') == 'module' and re.fullmatch(r'node:[a-zA-Z0-9_/-]+', path):
            path = ''
        if path and (path.startswith('/') or ':' in path or '..' in PurePosixPath(path).parts):
            raise ValueError('Graph source must be a relative path')
        index[node_id] = len(compact)
        compact.append([text(node.get('label', node_id), 2000), path,
                        text(node.get('source_location') or ''), source_group(path),
                        text(str(node.get('community', '')), 100),
                        text(node.get('node_kind', node.get('type', 'symbol')), 100), node_id])
    links = []
    for edge in edges:
        source, target = edge.get('source'), edge.get('target')
        if not isinstance(source, str) or not isinstance(target, str) or source not in index or target not in index:
            raise ValueError('Dangling graph edge')
        links.append([index[source], index[target], text(edge.get('relation', 'related'), 100)])
    return {'meta': {'source': sha, 'date': text(metadata.get('build_date', ''), 100),
                     'version': '0.9.90', 'files': metadata['files']}, 'nodes': compact, 'edges': links}


def render_html(payload):
    data = json.dumps(payload, ensure_ascii=True, separators=(',', ':'))
    for char, escaped in (('<', '\\u003c'), ('>', '\\u003e'), ('&', '\\u0026')):
        data = data.replace(char, escaped)
    template = TEMPLATE.read_text(encoding='utf-8')
    script = re.search(r'<script id="universe-app">(.*?)</script>', template, re.S)
    if script is None or template.count('__GRAPH_DATA__') != 1:
        raise ValueError('Invalid universe template')
    digest = base64.b64encode(hashlib.sha256(script.group(1).encode()).digest()).decode()
    html = template.replace('__SCRIPT_HASH__', digest).replace('__GRAPH_DATA__', data)
    if len(html.encode('utf-8')) >= MAX_HTML_BYTES:
        raise ValueError('Universe HTML exceeds the 10 MB publication limit')
    return html


def export_universe(graph_path, metadata_path, output_path):
    graph_path, metadata_path, output_path = map(Path, (graph_path, metadata_path, output_path))
    if (output_path.is_symlink() or output_path.resolve() in (graph_path.resolve(), metadata_path.resolve())
            or graph_path.stat().st_size > 100_000_000):
        raise ValueError('Unsafe universe export path or input size')
    graph_bytes, metadata_bytes = graph_path.read_bytes(), metadata_path.read_bytes()
    payload = build_payload(json.loads(graph_bytes), json.loads(metadata_bytes))
    html = render_html(payload).encode('utf-8')
    if graph_path.read_bytes() != graph_bytes or metadata_path.read_bytes() != metadata_bytes:
        raise ValueError('Graph changed during universe export')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output_path.parent, prefix='.universe-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(html)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output_path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    if output_path.read_bytes() != html:
        raise OSError('Universe export readback failed')
    return {'bytes': len(html), 'nodes': len(payload['nodes']), 'edges': len(payload['edges']),
            'source_commit': payload['meta']['source'], 'sha256': hashlib.sha256(html).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, required=True)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export_universe(args.graph, args.metadata, args.output)))
