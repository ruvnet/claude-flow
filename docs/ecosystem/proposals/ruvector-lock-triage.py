#!/usr/bin/env python3
"""Read-only lockfile paths, NOT Cargo feature resolution or an advisory scan."""
import collections
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tomllib

root = Path(sys.argv[1]).resolve()
raw = (root / 'Cargo.lock').read_bytes()
packages = tomllib.loads(raw.decode())['package']
by_name = collections.defaultdict(list)
for package in packages:
    by_name[package['name']].append(package)

def key(package):
    value = package['name'] + ' ' + package['version']
    if len([p for p in by_name[package['name']]
            if p['version'] == package['version']]) > 1:
        value += ' (' + package.get('source', 'local') + ')'
    return value

def resolve(dependency):
    parts = dependency.split()
    matches = [p for p in by_name[parts[0]]
               if len(parts) == 1 or p['version'] == parts[1]]
    if len(parts) > 2:
        matches = [p for p in matches if p.get('source') == parts[2][1:-1]]
    elif len(matches) > 1:
        matches = [p for p in matches if not p.get('source')]
    if len(matches) != 1:
        raise ValueError('Ambiguous/unresolved dependency: ' + dependency)
    return key(matches[0])

graph = {key(p): [resolve(d) for d in p.get('dependencies', [])]
         for p in packages}
reverse = collections.defaultdict(list)
for source, targets in graph.items():
    for target in targets:
        reverse[target].append(source)

def paths(source):
    queue = collections.deque([[source]])
    seen = {source}
    found = []
    while queue:
        path = queue.popleft()
        if path[-1].split()[0] in ('zip', 'rustls'):
            found.append(path)
        for target in graph[path[-1]]:
            if target not in seen:
                seen.add(target)
                queue.append(path + [target])
    return found

roots = ('ruvector-node', 'ruvector-graph-node', 'ruvector-gnn-node')
targets = [key(p) for p in packages if p['name'] in ('zip', 'rustls')]
result = {
    'kind': 'read-only-static-lockfile-overapproximation',
    'featureResolution': False,
    'advisoryRescan': False,
    'sourceCommit': subprocess.check_output(
        ['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
    'lockSha256': hashlib.sha256(raw).hexdigest(),
    'lockPackages': len(packages),
    'directParents': {target: reverse[target] for target in targets},
    'npmNativeRootPaths': {
        key(p): paths(key(p)) for name in roots for p in by_name[name]},
    'rustlsLockedDependencies': [p['dependencies'] for p in by_name['rustls']],
    'limitation': 'Lock edges include optional/dev/target dependencies. Paths are not runtime reachability. Source defaults require separate inspection; published npm binaries are not reproduced.'
}
print(json.dumps(result, indent=2))
