import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[1] / 'collect-runtime-relationships.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def archive(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as tar:
        for name, content, kind in entries:
            data = content.encode()
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = len(data) if kind == tarfile.REGTYPE else 0
            tar.addfile(member, io.BytesIO(data))
    return out.getvalue()


IMPORT = "import { execSync } from 'node:child_process';\n"


class RuntimeRelationships(unittest.TestCase):
    def test_command_array_dataflow(self):
        source = IMPORT + "const cmd = ['npx --yes metaharness@latest', name].join(' ');\nexecSync(cmd, {});"
        self.assertEqual(c.runtime_match(source)[2], 'latest')

    def test_args_template_dataflow(self):
        source = IMPORT + "const args = ['--yes', 'metaharness@0.12.4', name];\nexecSync(`npx ${args.map(a => a).join(' ')}`, {});"
        self.assertEqual(c.runtime_match(source)[2], '0.12.4')

    def test_args_join_dataflow(self):
        source = IMPORT + "const args = ['npx', '--yes', 'metaharness@latest'];\nexecSync(args.join(' '), {});"
        self.assertEqual(c.runtime_match(source)[2], 'latest')

    def test_template_command_dataflow(self):
        source = IMPORT + "const cmd = `npx --yes metaharness@latest ${name} --force`;\nexecSync(cmd, {});"
        self.assertEqual(c.runtime_match(source)[2], 'latest')

    def test_args_map_alias_dataflow(self):
        source = IMPORT + "const args = ['npx', '--yes', 'metaharness@latest'];\nconst cmd = args.map(a => a).join(' ');\nexecSync(cmd, {});"
        self.assertEqual(c.runtime_match(source)[2], 'latest')

    def test_mentions_comments_unused_array_not_relationship(self):
        for source in ("// npx metaharness@latest", IMPORT + "console.log('npx --yes metaharness@latest');", IMPORT + "const cmd = ['npx --yes metaharness@latest'];\nexecSync(other);", IMPORT + "/* const cmd = ['npx --yes metaharness@latest']; execSync(cmd); */"):
            self.assertIsNone(c.runtime_match(source))

    def test_tarball_integrity_failure(self):
        data = b'original'
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        c.verify_integrity(data, integrity, hashlib.sha1(data).hexdigest())
        with self.assertRaises(ValueError):
            c.verify_integrity(data + b'changed', integrity)
        with self.assertRaises(ValueError):
            c.verify_integrity(data, integrity, '0' * 40)

    def test_safe_read_without_extract(self):
        data = archive([('package/bin/scaffold.mjs', IMPORT, tarfile.REGTYPE), ('package/native/a.node', 'binary', tarfile.REGTYPE)])
        files, names = c.inspect_archive(data)
        self.assertEqual(list(files), ['package/bin/scaffold.mjs'])
        self.assertIn('package/native/a.node', names)

    def test_reject_traversal_symlink_and_duplicate(self):
        cases = [[('../escape', '', tarfile.REGTYPE)], [('package/link', '', tarfile.SYMTYPE)], [('package/a', '', tarfile.REGTYPE), ('package/a', '', tarfile.REGTYPE)]]
        for entries in cases:
            with self.assertRaises(ValueError):
                c.inspect_archive(archive(entries))

    def test_source_budget(self):
        with patch.object(c, 'MAX_SOURCE', 8):
            with self.assertRaises(ValueError):
                c.inspect_archive(archive([('package/index.js', 'x' * 9, tarfile.REGTYPE)]))

    def test_url_rejection_precedes_network(self):
        for url in ('http://registry.npmjs.org/a', 'https://evil.example/a', 'https://registry.npmjs.org/a?secret=1'):
            with self.assertRaises(ValueError):
                c.fetch(url, 10)

    def test_archive_identity_and_evidence(self):
        name, version = '@metaharness/coding', '0.1.0'
        js = IMPORT + "const cmd = ['npx --yes metaharness@latest'].join(' ');\nexecSync(cmd, {});"
        body = archive([('package/package.json', json.dumps({'name': name, 'version': version}), tarfile.REGTYPE), ('package/bin/scaffold.mjs', js, tarfile.REGTYPE)])
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(body).digest()).decode()
        node = {'name': name, 'version': version, 'integrity': integrity}
        meta = {'name': name, 'version': version, 'dist': {'tarball': c.REGISTRY + name + '/-/coding-0.1.0.tgz', 'integrity': integrity, 'shasum': hashlib.sha1(body).hexdigest()}}
        with patch.object(c, 'fetch', side_effect=[json.dumps(meta).encode(), body]):
            links = c.collect_one(node)
        self.assertEqual(links[0]['evidence']['sourceSha256'], hashlib.sha256(js.encode()).hexdigest())
        self.assertEqual(links[0]['evidence']['line'], 2)
        meta['version'] = '0.2.0'
        with patch.object(c, 'fetch', return_value=json.dumps(meta).encode()):
            with self.assertRaisesRegex(ValueError, 'version mismatch'):
                c.collect_one(node)

    def test_snapshot_integrity_drift(self):
        node = {'name': '@metaharness/coding', 'version': '0.1.0', 'integrity': 'pinned'}
        meta = {**node, 'dist': {'integrity': 'changed'}}
        with patch.object(c, 'fetch', return_value=json.dumps(meta).encode()):
            with self.assertRaisesRegex(ValueError, 'integrity drift'):
                c.collect_one(node)

    def test_snapshot_hash_and_scope(self):
        graph = {'nodes': [{'name': '@metaharness/coding', 'version': '0.1.0'}, {'name': 'metaharness', 'version': '1.0.0'}, {'name': 'other', 'version': '1.0.0'}], 'edges': []}
        source = json.dumps(graph).encode()
        link = {'source': '@metaharness/coding', 'target': 'metaharness'}
        with patch.object(c, 'collect_one', return_value=[link]) as mocked:
            report = c.collect(source)
            self.assertEqual(mocked.call_count, 1)
        self.assertEqual(report['sourceSnapshotSha256'], hashlib.sha256(source).hexdigest())
        self.assertEqual(report['relationships'], [link])

    def test_missing_target_is_not_synthetic_node(self):
        source = json.dumps({'nodes': [{'name': '@metaharness/coding', 'version': '0.1.0'}], 'edges': []}).encode()
        with patch.object(c, 'collect_one', return_value=[{'source': '@metaharness/coding', 'target': 'metaharness'}]):
            report = c.collect(source)
        self.assertEqual(report['relationships'], [])
        self.assertIn('Target absent', report['unresolved'][0]['reason'])


if __name__ == '__main__':
    unittest.main()
