#!/usr/bin/env python3
"""Pinned six-fixture CuLifter CPU baseline; equal SASS/ELF input, narrow scope."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
BUNDLE = HERE.parent
SOURCE_COMMIT = 'bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b'
SOURCE_MANIFEST_SHA = '0bf6cfe997e8cef489102a0b7aa9dedbff40db05b500e3f29fae01e3dbc3ac9d'
PLAN_SHA = '2274fd56eb38d830c195e4be9d454731c1be2527c04d2d67d56bd377140fb1f3'
EVALUATORS = ['run-equal-input.py', 'generate-driver.py', 'inspect-abi.py', '../emit-object.py']
MAX_RETAINED_BYTES = 64 * 1024 * 1024
IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,127}\Z')
DIGEST = re.compile(r'[0-9a-f]{64}\Z')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_bound(path, digest, maximum=8 * 1024 * 1024):
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise ValueError('invalid expected digest')
    flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError('input must be a regular file')
        if metadata.st_size > maximum:
            raise ValueError('input size outside scope')
        chunks, count = [], 0
        while count <= maximum:
            chunk = os.read(descriptor, min(65536, maximum + 1 - count))
            if not chunk:
                break
            chunks.append(chunk); count += len(chunk)
        if count > maximum:
            raise ValueError('input grew beyond size limit')
        data = b''.join(chunks)
    finally:
        os.close(descriptor)
    if sha(data) != digest:
        raise ValueError('digest mismatch: ' + path.name)
    return data


def relative_file(root, value):
    if not isinstance(value, str):
        raise ValueError('invalid file path')
    relative = PurePosixPath(value)
    if relative.is_absolute() or '..' in relative.parts or not relative.parts:
        raise ValueError('file path escapes input root')
    path = root.joinpath(*relative.parts)
    path.resolve(strict=True).relative_to(root.resolve(strict=True))
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'inputs', 'oracles', 'policy', 'output']:
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--policy-sha256', required=True)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    inputs = args.inputs.resolve(strict=True)
    oracles = args.oracles.resolve(strict=True)
    output = args.output.resolve()
    policy_bytes = read_bound(args.policy, args.policy_sha256)
    policy = json.loads(policy_bytes)
    if policy.get('schemaVersion') != 1 or policy.get('independentPlanSha256') != PLAN_SHA:
        raise ValueError('independent frozen plan differs')
    evaluator_hashes = {name: sha((HERE / name).read_bytes()) for name in EVALUATORS}
    if policy.get('evaluatorHashes') != evaluator_hashes:
        raise ValueError('evaluator changed after freeze')
    source_manifest_bytes = read_bound(BUNDLE / 'upstream-files.json', SOURCE_MANIFEST_SHA)
    source_manifest = json.loads(source_manifest_bytes)
    if source_manifest['commit'] != SOURCE_COMMIT:
        raise ValueError('source commit differs')
    manifest_bytes = read_bound(inputs / 'manifest.json', policy['inputManifestSha256'])
    manifest = json.loads(manifest_bytes)
    architecture = manifest['architecture']
    if architecture not in ['sm_75', 'sm_80', 'sm_86', 'sm_89', 'sm_90']:
        raise ValueError('architecture outside frozen scalar scope')
    approved = policy['kernels']
    if not isinstance(approved, list) or len(approved) != 6:
        raise ValueError('expected six independent fixtures')
    if len(manifest['artifacts']) != 6:
        raise ValueError('input manifest must contain exactly six fixtures')
    bound = {}
    staged_bytes = {}
    retained_bytes = len(policy_bytes) + len(source_manifest_bytes) + len(manifest_bytes)

    def retain(data):
        nonlocal retained_bytes
        retained_bytes += len(data)
        if retained_bytes > MAX_RETAINED_BYTES:
            raise ValueError('retained input byte budget exceeded')
        return data
    for kernel in approved:
        name, symbol = kernel['id'], kernel['symbol']
        if not isinstance(name, str) or not IDENTIFIER.fullmatch(name) or not isinstance(symbol, str) or not IDENTIFIER.fullmatch(symbol) or name in bound:
            raise ValueError('invalid or duplicate kernel identifier')
        matches = [item for item in manifest['artifacts'] if item['id'] == name]
        if len(matches) != 1 or matches[0].get('symbol', name) != symbol:
            raise ValueError('missing or differing input symbol')
        item = matches[0]
        for suffix in ['sass', 'elf']:
            path = relative_file(inputs, item.get(suffix + 'File', name + '.' + suffix))
            staged_bytes[name + '.' + suffix] = retain(read_bound(path, item[suffix + 'Sha256']))
        oracle_bytes = read_bound(relative_file(oracles, name + '.oracle.json'), kernel['oracleSha256'])
        oracle = json.loads(oracle_bytes)
        if oracle['id'] != name:
            raise ValueError('oracle identity mismatch')
        staged_bytes[name + '.oracle.json'] = retain(oracle_bytes)
        bound[name] = {'id': name, 'symbol': symbol, 'oracleSha256': kernel['oracleSha256'],
                       'sassSha256': item['sassSha256'], 'elfSha256': item['elfSha256']}
    # Validate all source bytes before staging anything or executing any code.
    source_bytes = {}
    for item in source_manifest['files']:
        source_bytes[item['path']] = retain(read_bound(relative_file(source, item['path']), item['sha256']))
    output.mkdir(parents=True, exist_ok=False)
    snapshot = output / 'source'
    for name, data in source_bytes.items():
        path = snapshot / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
    admitted = output / 'admitted'; admitted.mkdir()
    for name, data in staged_bytes.items():
        (admitted / name).write_bytes(data)
    (admitted / 'manifest.json').write_bytes(manifest_bytes)
    (admitted / 'policy.json').write_bytes(policy_bytes)
    env = {'PATH': '/usr/bin:/bin', 'HOME': str(output), 'PYTHONHASHSEED': '0'}
    runs = []

    def run(label, argv):
        started = time.perf_counter()
        try:
            result = subprocess.run(argv, cwd=output, env=env, text=True, capture_output=True, timeout=60)
            code, stdout, stderr = result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            code, stdout, stderr = None, '', 'timeout'
        except OSError as error:
            code, stdout, stderr = None, '', type(error).__name__ + ': process unavailable'
        (output / (label + '.stdout')).write_text(stdout)
        (output / (label + '.stderr')).write_text(stderr)
        runs.append({'label': label, 'argv': argv, 'exitCode': code, 'seconds': time.perf_counter() - started})
        return code, stdout, stderr

    compiler = '/usr/bin/g++'
    compiler_code, compiler_version, _ = run('native-compiler-version', [compiler, '--version'])
    results = []
    for name, binding in bound.items():
        result = {'kernel': name, 'state': 'inconclusive', 'cases': None, 'comparisons': None,
                  'semanticAccuracy': None}
        results.append(result)
        if compiler_code != 0:
            result.update(reason='native compiler unavailable', failedStage='compiler')
            continue
        stem = output / name
        abi_path = output / (name + '.abi.json')
        code, _, _ = run(name + '-abi', [sys.executable, str(HERE / 'inspect-abi.py'), '--source', str(snapshot),
                                         '--sass', str(admitted / (name + '.sass')), '--elf', str(admitted / (name + '.elf')),
                                         '--symbol', binding['symbol'], '--architecture', architecture, '--output', str(abi_path)])
        if code != 0:
            result.update(failedStage='abi', exitCode=code)
            if code == 2 and abi_path.is_file():
                result.update(state='unsupported_scope', reason=json.loads(abi_path.read_text()).get('reason'))
            continue
        code, stdout, _ = run(name + '-driver', [sys.executable, str(HERE / 'generate-driver.py'),
                                                '--oracle', str(admitted / (name + '.oracle.json')), '--abi', str(abi_path),
                                                '--symbol', binding['symbol'], '--output', str(stem) + '.cpp'])
        if code != 0:
            result.update(failedStage='oracle_driver', exitCode=code)
            continue
        try:
            driver = json.loads(stdout)
            expected = {'status': 'pass', **driver['expected']}
            if expected != {'status': 'pass', 'kernel': name, 'cases': 6, 'comparisons': 168}:
                raise ValueError('frozen workload count differs')
        except (ValueError, KeyError, TypeError):
            result.update(failedStage='oracle_driver', reason='invalid driver receipt')
            continue
        result['driverSha256'] = driver['driverSha256']
        stages = [('lift', [sys.executable, str(snapshot / 'main.py'), '-i', str(admitted / (name + '.sass')),
                           str(admitted / (name + '.elf')), '-o', str(stem), '-name', binding['symbol'], '--lifter', 'x86']),
                  ('object', [sys.executable, str(BUNDLE / 'emit-object.py'), str(stem) + '.ll', str(stem) + '.o']),
                  ('link', [compiler, '-std=c++20', '-O2', str(stem) + '.cpp', str(stem) + '.o', '-o', str(stem)]),
                  ('execute', [str(stem)])]
        for stage, argv in stages:
            code, stdout, stderr = run(name + '-' + stage, argv)
            if code != 0:
                result.update(state='inconclusive' if code is None else stage + '_failed', failedStage=stage, exitCode=code)
                if stage == 'lift' and 'UnsupportedInstructionException' in stderr:
                    result['state'] = 'unsupported_instruction'
                break
            if stage == 'execute':
                try:
                    observed = json.loads(stdout)
                except ValueError:
                    observed = None
                if observed != expected:
                    result.update(state='invalid_result', failedStage='execute')
                    break
                result.update(state='passed', cases=6, comparisons=168, semanticAccuracy=1.0)
    from llvmlite import binding as llvm
    receipt = {'schemaVersion': 1, 'claim': 'Equal-input six-fixture SASS/ELF CPU baseline; no broad SOTA or GPU performance claim.',
               'sourceCommit': SOURCE_COMMIT, 'sourceManifestSha256': SOURCE_MANIFEST_SHA,
               'independentPlanSha256': PLAN_SHA, 'policySha256': args.policy_sha256,
               'inputManifestSha256': policy['inputManifestSha256'], 'inputBindings': bound,
               'evaluatorHashes': evaluator_hashes, 'architecture': architecture,
               'environment': {'python': sys.version.split()[0], 'llvm': list(llvm.llvm_version_info),
                               'nativeCompiler': compiler_version.rstrip('\n'), 'nativeCompilerPath': compiler,
                               'nativeCompilerVersionSha256': sha((output / 'native-compiler-version.stdout').read_bytes())},
               'results': results, 'expectedKernelCount': 6, 'expectedCaseCount': 36, 'expectedComparisonCount': 1008,
               'measuredCaseCount': sum(r['cases'] or 0 for r in results),
               'measuredComparisonCount': sum(r['comparisons'] or 0 for r in results),
               'semanticAccuracy': 1.0 if all(r['state'] == 'passed' for r in results) else None,
               'gpuExecutedByThisProbe': False, 'costUSD': None, 'promotionVerdict': 'INCONCLUSIVE',
               'runs': runs, 'artifactHashes': {p.name: sha(p.read_bytes()) for p in output.iterdir() if p.is_file()}}
    (output / 'equal-input-result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'results': results, 'receipt': str(output / 'equal-input-result.json')}))
    return 0 if all(r['state'] == 'passed' for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
