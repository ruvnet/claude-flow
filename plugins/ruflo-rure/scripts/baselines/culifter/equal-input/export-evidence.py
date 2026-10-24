#!/usr/bin/env python3
"""Export an explicit public evidence allowlist; exclude upstream and binaries."""
import argparse
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['run', 'projection', 'audit', 'output']:
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    raw_path = args.run / 'equal-input-result.json'; raw_bytes = raw_path.read_bytes()
    raw = json.loads(raw_bytes)
    policy_bytes = (args.projection / 'policy.json').read_bytes(); policy = json.loads(policy_bytes)
    if raw['policySha256'] != digest(policy_bytes):
        raise ValueError('policy does not match executed receipt')
    audit_bytes = args.audit.read_bytes(); audit = json.loads(audit_bytes)
    if audit['receiptSha256'] != digest(raw_bytes) or audit['status'] != 'pass':
        raise ValueError('independent audit binding differs')
    ids = [row['id'] for row in policy['kernels']]
    if len(ids) != 6 or len(set(ids)) != 6 or [row['kernel'] for row in raw['results']] != ids:
        raise ValueError('six-fixture denominator differs')
    first_abi = next(row for row in raw['runs'] if row['label'].endswith('-abi'))
    recorded_python = first_abi['argv'][0]
    recorded_base = str(Path(first_abi['argv'][1]).parent)
    recorded_output = str(args.run.resolve())
    replacements = [(recorded_python, '${PYTHON}'),
                    (str(Path(recorded_base).parent / 'emit-object.py'), '${BASELINE_DIR}/../emit-object.py'),
                    (recorded_base, '${BASELINE_DIR}'), (recorded_output, '${OUTPUT}')]
    replacements.sort(key=lambda row: len(row[0]), reverse=True)

    def sanitize(data):
        text = data.decode('utf-8')
        for original, marker in replacements:
            text = text.replace(original, marker)
        if re.search(r'/(?:workspace|home|root|opt/codex|run/user)/', text):
            raise ValueError('unmapped workspace/private path in public evidence')
        return text.encode()

    pending = {}
    provenance = []

    def retain(name, path, expected=None):
        original = path.read_bytes()
        if expected is not None and digest(original) != expected:
            raise ValueError('retained artifact digest differs: ' + name)
        public = sanitize(original)
        pending[name] = public
        provenance.append({'path': name, 'rawSha256': digest(original), 'publicSha256': digest(public),
                           'pathSubstitutionApplied': original != public})

    retained_receipt = json.loads(sanitize(raw_bytes))
    retained_receipt['publication'] = {'rawReceiptSha256': digest(raw_bytes),
                                     'transformation': 'workspace/interpreter path placeholders only; measurements and original artifact hashes unchanged',
                                     'placeholders': ['${PYTHON}', '${BASELINE_DIR}', '${OUTPUT}']}
    pending['equal-input-result.public.json'] = (json.dumps(retained_receipt, indent=2) + '\n').encode()
    retain('independent-audit.json', args.audit)
    for name in ['policy.json', 'projection-receipt.json', 'translation-input.json', 'input-approval.json']:
        retain(name, args.projection / name)
    retain('inputs/manifest.json', args.projection / 'inputs/manifest.json', raw['inputManifestSha256'])
    for name in ids:
        for suffix in ['sass', 'elf']:
            retain('inputs/' + name + '.' + suffix, args.projection / 'inputs' / (name + '.' + suffix),
                   raw['inputBindings'][name][suffix + 'Sha256'])
        retain('drivers/' + name + '.cpp', args.run / (name + '.cpp'), raw['artifactHashes'][name + '.cpp'])
        retain('abi/' + name + '.abi.json', args.run / (name + '.abi.json'), raw['artifactHashes'][name + '.abi.json'])
    process_logs = {}
    for run in raw['runs']:
        label = run['label']
        if not re.fullmatch(r'[A-Za-z0-9_-]+', label):
            raise ValueError('invalid process label')
        for suffix in ['stdout', 'stderr']:
            name = label + '.' + suffix
            original = (args.run / name).read_bytes()
            if digest(original) != raw['artifactHashes'][name]:
                raise ValueError('process log digest differs')
            public = sanitize(original)
            process_logs[name] = {'text': public.decode('utf-8'), 'rawSha256': digest(original),
                                  'publicSha256': digest(public), 'pathSubstitutionApplied': public != original}
    pending['process-logs.json'] = (json.dumps(process_logs, indent=2) + '\n').encode()
    pending['commands.json'] = (json.dumps({'scope': 'recorded stage argv with documented path placeholders',
                                           'rawReceiptSha256': digest(raw_bytes),
                                           'runs': retained_receipt['runs']}, indent=2) + '\n').encode()
    exports = {'schemaVersion': 1, 'rawReceiptSha256': digest(raw_bytes),
               'independentAuditSha256': digest(audit_bytes),
               'exporterSha256': digest(Path(__file__).read_bytes()),
               'scope': 'explicit allowlist; no upstream implementation, LLVM, object, executable, credentials or oracle files',
               'files': [{'path': name, 'sha256': digest(data)} for name, data in sorted(pending.items())],
               'rawToPublicMappings': provenance}
    args.output.mkdir(parents=True, exist_ok=False)
    for name, data in pending.items():
        path = args.output / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
    (args.output / 'publication-manifest.json').write_text(json.dumps(exports, indent=2) + '\n')
    print(json.dumps({'files': len(pending), 'publicationManifestSha256': digest((args.output / 'publication-manifest.json').read_bytes()),
                      'publicReceiptSha256': digest(pending['equal-input-result.public.json'])}))


if __name__ == '__main__':
    main()
