#!/usr/bin/env python3
"""Compile frozen evaluator-owned sources before exposing native inputs to a lifter.

This prepares artifacts only. It never invokes recoverSass or allocates hardware.
Run on an already authorized isolated CUDA compiler host. Source/oracle files must
not enter the translator's input directory or prompts.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import shutil
import tarfile

if not __debug__:
    raise RuntimeError('assertions are required; do not use optimized Python')

PLAN_SHA256 = '2274fd56eb38d830c195e4be9d454731c1be2527c04d2d67d56bd377140fb1f3'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def translation_projection(output, receipt):
    translator = output / 'translation-input'
    translator.mkdir()
    for kernel in receipt['kernels']:
        destination = translator / kernel['id']
        destination.mkdir()
        for name in ['original.sass', 'original.elf']:
            shutil.copyfile(output / kernel['id'] / name, destination / name)
    manifest = {'schemaVersion': 1, 'architecture': receipt['architecture'],
                'kernels': [{key: kernel[key] for key in ['id', 'sassSha256', 'elfSha256']}
                            for kernel in receipt['kernels']]}
    (translator / 'translation-input.json').write_text(json.dumps(manifest, indent=2) + '\n')
    receipt['translationInputManifestSha256'] = sha(translator / 'translation-input.json')


def retained_development(archive, output):
    expected = '62f1acc98b0f0e81c3679f4f719a273cb0307a6027b16a1bbeb7bfdf25e64a48'
    assert sha(archive) == expected, 'retained archive digest mismatch'
    receipt = {'schemaVersion': 1, 'status': 'prepared-not-evaluated', 'architecture': 'sm_89',
               'scope': 'four exposed development regressions from retained auxiliary ptxas cubins; not previously GPU-executed cubin bytes',
               'parentArchiveSha256': expected, 'startedAt': time.time(), 'kernels': []}
    with tarfile.open(archive, 'r:gz') as tar:
        def read(name):
            member = tar.getmember('baseline-inputs/' + name)
            assert member.isfile() and member.size <= 4 * 1024 * 1024
            return tar.extractfile(member).read()
        original = json.loads(read('manifest.json'))
        assert original['architecture'] == 'sm_89'
        for name in ['nvcc', 'ptxas', 'cuobjdump']:
            receipt[name] = original[name]
        for name in ['copy32', 'add7_wrap32', 'multiply_low64', 'wide_signed']:
            entry = next(k for k in original['artifacts'] if k['id'] == name)
            (output / name).mkdir()
            row = {'id': name}
            for extension, suffix, field, original_field in [
                    ('sass', '.sass', 'sassSha256', 'sassSha256'),
                    ('elf', '.elf', 'elfSha256', 'elfSha256'),
                    ('cubin', '.original.cubin', 'cubinSha256', 'originalCubinSha256')]:
                data = read(name + suffix)
                assert hashlib.sha256(data).hexdigest() == entry[original_field]
                (output / name / ('original.' + extension)).write_bytes(data)
                row[field] = entry[original_field]
            receipt['kernels'].append(row)
    translation_projection(output, receipt)
    receipt['nativeArtifactsFrozenAt'] = time.time()
    (output / 'native-manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': receipt['status'], 'kernels': 4,
                      'nativeManifestSha256': sha(output / 'native-manifest.json')}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--spec-dir', type=Path)
    source.add_argument('--retained-development', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--arch', choices=['sm_86', 'sm_89'])
    args = parser.parse_args()
    assert not args.output.exists(), 'preserve prior native artifacts'
    if args.retained_development:
        args.output.mkdir(parents=True, mode=0o700)
        return retained_development(args.retained_development, args.output)
    assert args.arch, '--arch is required for fresh native compilation'
    assert sha(args.spec_dir / 'confirmation-plan.json') == PLAN_SHA256
    plan = json.loads((args.spec_dir / 'confirmation-plan.json').read_text())
    args.output.mkdir(parents=True, mode=0o700)
    started = time.monotonic()
    receipt = {'schemaVersion': 1, 'status': 'incomplete', 'architecture': args.arch,
               'planSha256': PLAN_SHA256, 'startedAt': time.time(), 'commands': [], 'kernels': []}
    env = {'PATH': os.environ.get('PATH', '/usr/local/cuda/bin:/usr/bin:/bin'), 'LANG': 'C', 'LC_ALL': 'C'}

    def run(command):
        remaining = 180 - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError('native preparation deadline exceeded')
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=min(60, remaining))
        receipt['commands'].append({'argv': command, 'exitCode': result.returncode,
                                    'stdout': result.stdout, 'stderr': result.stderr})
        if result.returncode:
            raise RuntimeError('native preparation command failed: ' + command[0])
        return result.stdout

    try:
        receipt['executables'] = {}
        for name in ['nvcc', 'cuobjdump', 'ptxas']:
            executable = shutil.which(name, path=env['PATH'])
            assert executable, 'missing required compiler tool: ' + name
            executable = Path(executable).resolve(strict=True)
            assert executable.is_file()
            receipt['executables'][name] = {'path': str(executable), 'sha256': sha(executable)}
        receipt['nvcc'] = run(['nvcc', '--version'])
        receipt['cuobjdump'] = run(['cuobjdump', '--version'])
        for kernel in plan['kernels']:
            name = kernel['id']
            assert name.startswith('confirm_') and name.replace('_', '').isalnum()
            source = args.spec_dir / (name + '.cu')
            assert sha(source) == kernel['sourceSha256']
            directory = args.output / name
            directory.mkdir()
            binary = directory / 'original.cubin'
            run(['nvcc', '-std=c++17', '-cubin', '-arch=' + args.arch, str(source), '-o', str(binary)])
            assert binary.read_bytes().startswith(b'\x7fELF')
            sass = run(['cuobjdump', '-sass', str(binary)])
            elf = run(['cuobjdump', '-elf', str(binary)])
            (directory / 'original.sass').write_text(sass)
            (directory / 'original.elf').write_text(elf)
            receipt['kernels'].append({'id': name, 'sourceSha256': sha(source),
                                       'sassSha256': sha(directory / 'original.sass'),
                                       'elfSha256': sha(directory / 'original.elf'),
                                       'cubinSha256': sha(binary)})
        assert len(receipt['kernels']) == 6
        translation_projection(args.output, receipt)
        receipt['status'] = 'prepared-not-evaluated'
        receipt['nativeArtifactsFrozenAt'] = time.time()
    except Exception as error:
        receipt['status'] = 'failed'
        receipt['error'] = {'type': type(error).__name__, 'message': str(error)}
    finally:
        receipt['elapsedSeconds'] = time.monotonic() - started
        (args.output / 'native-manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'status': receipt['status'], 'kernels': len(receipt['kernels']),
                      'nativeManifestSha256': sha(args.output / 'native-manifest.json')}))
    return 0 if receipt['status'] == 'prepared-not-evaluated' else 1


if __name__ == '__main__':
    raise SystemExit(main())
