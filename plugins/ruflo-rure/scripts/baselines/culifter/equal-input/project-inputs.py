#!/usr/bin/env python3
"""Metadata-only projection; preserves the approved native SASS/ELF bytes."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('frozen_equal_input', HERE / 'run-equal-input.py')
frozen = importlib.util.module_from_spec(spec); spec.loader.exec_module(frozen)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['inputs', 'approval', 'output']:
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--approval-sha256', required=True)
    parser.add_argument('--candidate-sha256', required=True)
    args = parser.parse_args()
    approval_bytes = frozen.read_bound(args.approval, args.approval_sha256)
    approval = json.loads(approval_bytes)
    freeze_bytes = (HERE / 'freeze.json').read_bytes(); freeze = json.loads(freeze_bytes)
    if approval['frozenPlanSha256'] != frozen.PLAN_SHA or freeze['independentPlanSha256'] != frozen.PLAN_SHA:
        raise ValueError('frozen plan differs')
    for name, digest in freeze['evaluatorHashes'].items():
        frozen.read_bound(HERE / name, digest)
    source_bytes = frozen.read_bound(args.inputs / 'translation-input.json', approval['translationInputManifestSha256'])
    source = json.loads(source_bytes)
    approved = approval['kernels']
    if len(approved) != 6 or [x['id'] for x in source['kernels']] != [x['id'] for x in approved]:
        raise ValueError('ordered six-fixture mapping differs')
    names = [x['id'] for x in approved]
    if len(set(names)) != 6 or any(not frozen.IDENTIFIER.fullmatch(name) for name in names):
        raise ValueError('invalid fixture identifier')
    files, artifacts, mappings = {}, [], []
    for observed, approved_kernel in zip(source['kernels'], approved):
        name = observed['id']; artifact = {'id': name, 'symbol': name}
        for suffix in ['sass', 'elf']:
            digest = observed[suffix + 'Sha256']
            if digest != approved_kernel[suffix + 'Sha256']:
                raise ValueError('approval differs from original manifest')
            original = name + '/original.' + suffix; target = name + '.' + suffix
            files[target] = frozen.read_bound(frozen.relative_file(args.inputs, original), digest)
            artifact[suffix + 'File'] = target; artifact[suffix + 'Sha256'] = digest
            mappings.append({'source': original, 'target': target, 'sha256': digest})
        artifacts.append(artifact)
    projected = {'schemaVersion': 1, 'architecture': source['architecture'],
                 'sourceTranslationInputManifestSha256': approval['translationInputManifestSha256'],
                 'artifacts': artifacts}
    manifest_bytes = (json.dumps(projected, indent=2) + '\n').encode()
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    policy = {'schemaVersion': 1, 'independentPlanSha256': frozen.PLAN_SHA,
              'inputManifestSha256': manifest_sha,
              'sourceTranslationInputManifestSha256': approval['translationInputManifestSha256'],
              'inputApprovalSha256': args.approval_sha256,
              'candidateSha256': args.candidate_sha256,
              'evaluatorHashes': freeze['evaluatorHashes'],
              'kernels': [{'id': row['id'], 'symbol': row['id'], 'oracleSha256': row['oracleSha256']} for row in approved]}
    policy_bytes = (json.dumps(policy, indent=2) + '\n').encode()
    receipt = {'schemaVersion': 1, 'scope': 'metadata-only transport projection; no input or oracle changes',
               'sourceManifestSha256': approval['translationInputManifestSha256'],
               'projectedManifestSha256': manifest_sha, 'policySha256': hashlib.sha256(policy_bytes).hexdigest(),
               'approvalSha256': args.approval_sha256, 'evaluatorFreezeSha256': hashlib.sha256(freeze_bytes).hexdigest(),
               'projectionScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'orderedKernelIds': names, 'fileMappings': mappings, 'oracleBytesModified': False}
    args.output.mkdir(parents=True, exist_ok=False)
    inputs = args.output / 'inputs'; inputs.mkdir()
    for name, data in files.items():
        (inputs / name).write_bytes(data)
    (inputs / 'manifest.json').write_bytes(manifest_bytes)
    (args.output / 'translation-input.json').write_bytes(source_bytes)
    (args.output / 'input-approval.json').write_bytes(approval_bytes)
    (args.output / 'policy.json').write_bytes(policy_bytes)
    (args.output / 'projection-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
