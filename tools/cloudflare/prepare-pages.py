#!/usr/bin/env python3
"""Stage an already-built Studio for Pages. Never include maps or source archives."""
import argparse
import gzip
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('build', type=Path)
parser.add_argument('output', type=Path, help='New, empty staging directory')
args = parser.parse_args()
source = args.build.resolve()
output = args.output.resolve()
if not (source / 'index.html').is_file():
    parser.error('build must contain index.html')
if output == source or source in output.parents or output in source.parents:
    parser.error('build and output must be separate, non-nested directories')
if output.exists() and any(output.iterdir()):
    parser.error('output must be empty; use a new staging directory')
output.mkdir(parents=True, exist_ok=True)
encoded = {}
count = 0
for path in sorted(source.rglob('*')):
    if not path.is_file():
        continue
    relative = path.relative_to(source)
    if any(part.startswith('.') for part in relative.parts):
        continue
    if path.name.endswith(('.map', '.br', '.gz', '.zip', '.tar', '.tgz', '.pem', '.key')):
        continue
    if path.name in ('_headers', '_worker.js', '_routes.json'):
        continue
    if path.is_symlink():
        parser.error(f'unexpected symlink: {relative}')
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    data = path.read_bytes()
    if len(data) > 25 * 1024 * 1024:
        if path.suffix != '.wasm':
            parser.error(f'oversized non-WASM asset: {relative}')
        data = gzip.compress(data, mtime=0)
        if len(data) > 25 * 1024 * 1024:
            parser.error(f'compressed asset still exceeds Pages limit: {relative}')
        route = '/' + relative.as_posix()
        target = target.with_name(target.name + '.payload')
        encoded[route] = route + '.payload'
    target.write_bytes(data)
    count += 1
headers = '''/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin
  Cache-Control: no-cache
'''
(output / '_headers').write_text(headers)
if encoded:
    worker = Path(__file__).with_name('large-wasm-worker.mjs').read_text()
    worker += '\nexport default createLargeWasmWorker(' + json.dumps(encoded) + ')\n'
    (output / '_worker.js').write_text(worker)
    (output / '_routes.json').write_text(json.dumps({'version': 1, 'include': list(encoded), 'exclude': []}))
print(f'Staged {count} files; streaming {len(encoded)} large WASM asset(s).')
