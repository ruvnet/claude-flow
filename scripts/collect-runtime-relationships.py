#!/usr/bin/env python3
"""Collect narrowly evidenced runtime links without installing or executing packages.

Only isolated @metaharness packages and the @ruvector/kge loader are inspected.
Recognizes the existing literal execSync scaffold patterns, not arbitrary JS.
Relationships are annotations; they never change npm dependency declarations.
"""
import argparse
import base64
import concurrent.futures
import datetime
import hashlib
import io
import json
import re
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REGISTRY = 'https://registry.npmjs.org/'
MAX_SOURCE = 1024 * 1024
MAX_ARCHIVE = 5 * 1024 * 1024
KGE_ARCHIVE = 20 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
PLATFORMS = ('darwin-arm64', 'darwin-x64', 'linux-arm64-gnu', 'linux-x64-gnu', 'win32-x64-msvc')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect rejected')


def fetch(url, limit):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'registry.npmjs.org' or parsed.query or parsed.fragment:
        raise ValueError('Only fixed official npm URLs are permitted')
    with urllib.request.build_opener(NoRedirect).open(url, timeout=20) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError('Download byte budget exceeded')
    return body


def verify_integrity(body, integrity, shasum=None):
    if not integrity or not integrity.startswith('sha512-') or len(integrity.split()) != 1:
        raise ValueError('Single SHA512 registry integrity required')
    expected = base64.b64decode(integrity[7:], validate=True)
    if hashlib.sha512(body).digest() != expected:
        raise ValueError('Tarball SHA512 mismatch')
    if shasum and hashlib.sha1(body).hexdigest() != shasum:
        raise ValueError('Tarball shasum mismatch')


def inspect_archive(body):
    """Stream tar entries, reject unsafe paths/types, retain selected text only."""
    selected, names, expanded = {}, set(), 0
    with tarfile.open(fileobj=io.BytesIO(body), mode='r|gz') as archive:
        for member in archive:
            expanded += member.size
            if expanded > MAX_EXPANDED or len(names) >= 10000:
                raise ValueError('Expanded archive budget exceeded')
            parts = member.name.split('/')
            if member.name.startswith('/') or '..' in parts or '\\' in member.name or member.name in names:
                raise ValueError('Unsafe or duplicate archive path')
            names.add(member.name)
            if not member.isfile() and not member.isdir():
                raise ValueError('Archive links and special files rejected')
            wanted = member.name in ('package/package.json', 'package/index.js') or (
                member.name.startswith('package/bin/') and member.name.endswith(('.js', '.mjs')))
            if wanted and member.isfile():
                if member.size > MAX_SOURCE:
                    raise ValueError('Source file budget exceeded')
                selected[member.name] = archive.extractfile(member).read(MAX_SOURCE + 1).decode('utf-8')
    if sum(len(v.encode()) for v in selected.values()) > MAX_SOURCE:
        raise ValueError('Total selected source budget exceeded')
    return selected, names


def runtime_match(source):
    # Exclude comments before matching the two observed scaffold dataflows.
    code = re.sub(r'/\*.*?\*/|(?m:^\s*//[^\n]*)', '', source, flags=re.S)
    if not re.search(r"import\s*\{\s*execSync\s*\}\s*from\s*['\"]node:child_process['\"]", code):
        return None
    template_cmd = re.search(r'const\s+cmd\s*=\s*`npx\s+--yes\s+metaharness@(latest|[0-9][^\s`$]*)\s', code)
    if template_cmd and re.search(r'execSync\(\s*cmd\s*,', code):
        for line, text in enumerate(source.splitlines(), 1):
            if template_cmd[0] in text:
                return line, text.strip(), template_cmd[1]
    for variable in ('cmd', 'args'):
        array = re.search(r'const\s+' + variable + r'\s*=\s*\[(.*?)\]\s*(?:;|\.filter|\.join)', code, re.S)
        if not array:
            continue
        literal = re.search(r"(['\"])(?:npx\s+--yes\s+)?metaharness@(latest|[0-9][^'\"\s]*)\1", array[1])
        if not literal:
            continue
        has_npx = 'npx --yes metaharness@' in array[1] or re.search(r"['\"]npx['\"]", array[1])
        use = re.search(r'execSync\(\s*' + variable + r'\s*(?:,|\.join\()', code)
        template = re.search(r'execSync\(\s*`npx\s+\$\{' + variable + r'\.map\(', code)
        alias = variable == 'args' and re.search(r'const\s+cmd\s*=\s*args\.map\([^;]+\.join\([^)]+\)\s*;', code) and re.search(r'execSync\(\s*cmd\s*,', code)
        if not ((has_npx and (use or alias)) or template):
            continue
        # Evidence line is taken from original source, never normalized source.
        for line, text in enumerate(source.splitlines(), 1):
            if literal[0] in text:
                return line, text.strip(), literal[2]
    return None


def evidence(meta, path, source, line, excerpt):
    return {'tarballUrl': meta['dist']['tarball'], 'integrity': meta['dist']['integrity'],
            'sourceFile': path, 'line': line, 'excerpt': excerpt,
            'sourceSha256': hashlib.sha256(source.encode()).hexdigest()}


def collect_one(node):
    name, version = node['name'], node['version']
    url = REGISTRY + urllib.parse.quote(name, safe='') + '/' + urllib.parse.quote(version, safe='')
    meta = json.loads(fetch(url, MAX_SOURCE))
    if meta.get('name') != name or meta.get('version') != version:
        raise ValueError('Registry name/version mismatch')
    dist = meta['dist']
    if node.get('integrity') != dist.get('integrity'):
        raise ValueError('Snapshot integrity drift')
    expected_url = REGISTRY + name + '/-/' + name.split('/')[-1] + '-' + version + '.tgz'
    if dist.get('tarball') != expected_url:
        raise ValueError('Unexpected registry tarball path')
    body = fetch(expected_url, KGE_ARCHIVE if name == '@ruvector/kge' else MAX_ARCHIVE)
    verify_integrity(body, dist.get('integrity'), dist.get('shasum'))
    files, names = inspect_archive(body)
    package = json.loads(files['package/package.json'])
    if package.get('name') != name or package.get('version') != version:
        raise ValueError('Tarball name/version mismatch')
    links = []
    if name == '@ruvector/kge':
        source = files.get('package/index.js', '')
        marker = "return tryRequire(`@ruvector/kge-${file.slice('kge.'.length, -'.node'.length)}`);"
        if marker not in source or "path.join(__dirname, 'native', file)" not in source or 'if (fs.existsSync(local)) return require(local);' not in source:
            raise ValueError('KGE loader contract changed')
        line = next(i for i, value in enumerate(source.splitlines(), 1) if marker in value)
        for platform in PLATFORMS:
            if 'package/native/kge.' + platform + '.node' not in names:
                raise ValueError('KGE bundled platform missing')
            links.append({'source': name, 'target': name + '-' + platform, 'sourceVersion': version,
                          'type': 'native-fallback', 'targetSelector': 'unversioned runtime require',
                          'evidence': evidence(meta, 'package/index.js', source, line, marker)})
    else:
        for path, source in sorted(files.items()):
            if not path.startswith('package/bin/'):
                continue
            match = runtime_match(source)
            if match:
                line, excerpt, selector = match
                links.append({'source': name, 'target': 'metaharness', 'sourceVersion': version,
                              'type': 'runtime-command', 'targetSelector': selector,
                              'evidence': evidence(meta, path, source, line, excerpt)})
    return links


def collect(snapshot_bytes, workers=4):
    graph = json.loads(snapshot_bytes)
    linked = {e[key] for e in graph['edges'] if e.get('internal') for key in ('source', 'target')}
    nodes = {n['name']: n for n in graph['nodes']}
    candidates = [n for n in nodes.values() if (n['name'].startswith('@metaharness/') and n['name'] not in linked) or n['name'] == '@ruvector/kge']
    relationships, unresolved = [], []
    def safe(node):
        try:
            return node, collect_one(node), None
        except Exception as error:
            return node, [], type(error).__name__ + ': ' + str(error)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for node, links, error in pool.map(safe, sorted(candidates, key=lambda n: n['name'])):
            if error or not links:
                unresolved.append({'package': node['name'], 'version': node['version'],
                                   'reason': error or 'No recognized runtime command in selected source'})
            for link in links:
                if link['target'] not in nodes:
                    unresolved.append({'package': node['name'], 'reason': 'Target absent from snapshot: ' + link['target']})
                else:
                    relationships.append(link)
    # An unresolved optional peer is a finding, never a synthetic relationship.
    findings = []
    peer = '@claude-flow/ruvector-upstream'
    users = sorted(n['name'] for n in nodes.values() if peer in n.get('peerDependencies', {}) and n.get('peerDependenciesMeta', {}).get(peer, {}).get('optional') is True)
    if users:
        url = REGISTRY + urllib.parse.quote(peer, safe='') + '/latest'
        try:
            fetch(url, MAX_SOURCE)
            state = 'available'
        except urllib.error.HTTPError as error:
            state = 'HTTP ' + str(error.code)
        except Exception as error:
            state = type(error).__name__ + ': ' + str(error)
        findings.append({'type': 'optional-peer-registry-check', 'package': peer, 'consumers': users,
                         'url': url, 'status': state, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    return {'schema': 'ruvnet.runtime-relationships.v1', 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sourceSnapshotSha256': hashlib.sha256(snapshot_bytes).hexdigest(),
            'scope': {'candidatePackages': len(candidates), 'selection': 'isolated @metaharness packages plus @ruvector/kge'},
            'relationships': sorted(relationships, key=lambda r: (r['source'], r['target'])),
            'unresolved': unresolved, 'findings': findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 9))
    args = parser.parse_args()
    report = collect(Path(args.input).read_bytes(), args.workers)
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'relationships': len(report['relationships']), 'unresolved': len(report['unresolved']), 'scope': report['scope']}))


if __name__ == '__main__':
    main()
