#!/usr/bin/env python3
"""Reproduce the post-execution audit of the frozen 2026-10-24 GPU receipt.

This is a read-only consistency audit, not executor authentication, a semantic
proof, or a promotion authority. It never executes candidate code or uses a GPU.
Usage: python3 ptx-recovery-receipt-audit.py RECEIPT_DIR FROZEN_BUNDLE_DIR
"""
import hashlib
import json
import math
from pathlib import Path
import sys
import tarfile

if not __debug__:
    raise RuntimeError('This receipt replay requires Python assertions; do not run with -O.')

# These are reviewed, already observed receipts, not a general promotion policy.
RECEIPTS = {
    '311f899315944390d1d65bd8dcf0e068aa0249f16351924f316c712debbffbf6': {
        'attempt': 2, 'architecture': 'sm_86', 'nvcc': '12.8.93',
        'worker': '875ba47c6701bbaa702397024003f37c7fcc6eb151c1db4b15ab1b79a09a3830',
        'driver': '9736c2f988c69e5a3a25f6851bb4b6503b0b8c7fb56eafc875e02edc0838b8a3',
        'image': 'nvidia/cuda@sha256:6617a625f4090c76c545a0e7d63f2e441718ef9af7f4efe7dd1242a29e289fd7',
        'archive': '9bccdd41c91e87c37460a9367dff5a1a2c314e1ea4316327b0250d600570aea4',
        'compiledArtifactsRetained': False,
    },
    '932a0787cad179d044de1d6c25518e63b3faf757a6481ddd32f4e7142ed3303f': {
        'attempt': 3, 'architecture': 'sm_89', 'nvcc': '13.0.88',
        'worker': 'b5c3f69f922043770df44cc1f0cd738df6f09f922082bffa54d3d67508abe41c',
        'driver': '5db3c5391663b5fae4952a1bd02c63256eb85bc77b22d284fb0dd4a26069b44f',
        'image': 'nvidia/cuda@sha256:0eee3094c71518ad31d011a594ae6ed6de72959ee07e318cb31cffe71690e90c',
        'archive': '62f1acc98b0f0e81c3679f4f719a273cb0307a6027b16a1bbeb7bfdf25e64a48',
        'compiledArtifactsRetained': True,
    },
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def audit(receipts, bundle):
    raw = read_json(receipts / 'gpu-raw.json')
    host = read_json(receipts / 'gpu-results.json')
    lock = read_json(receipts / 'workload-lock.json')
    manifest = read_json(bundle / 'manifest.json')
    raw_sha = digest(receipts / 'gpu-raw.json')
    if raw_sha not in RECEIPTS:
        raise ValueError('not a reviewed frozen receipt digest')
    expected = RECEIPTS[raw_sha]
    assert raw_sha == host['gpu-raw.json_sha256']
    assert host['input_sha256'] == lock
    assert lock == {
        'bundle.tar.gz': '347d6c2f9ec9716d9a8bec74134b0d96232231a08696eade5818f19cf2bc807f',
        'gpu_worker.py': expected['worker'],
        'ptx-recovery-gpu.cu': expected['driver'],
    }
    archive_sha = digest(receipts / 'baseline-inputs.tar.gz')
    assert archive_sha == host['baseline-inputs.tar.gz_sha256'] == raw['baselineInputsSha256'] == expected['archive']
    assert host['image'] == expected['image']
    assert raw['architecture'] == expected['architecture']
    assert 'V' + expected['nvcc'] in raw['nvcc']
    assert digest(bundle / 'manifest.json') == 'f1415ad1463c709fe80ef54e7f35115f174b3c952a20a79ddc367029ed3cd8e0'
    assert host['exitCode'] == 0 and raw['status'] == 'pass'
    positive = raw['positive']
    assert [positive[k] for k in ['kernels', 'cases', 'elementComparisons']] == [24, 168, 9360]
    ids = [k['id'] for k in manifest['kernels']]
    assert len(ids) == len(set(ids)) == 24
    assert [a['id'] for a in raw['artifacts']] == ids
    artifacts = {a['id']: a for a in raw['artifacts']}
    vector_files = 0
    retained = expected['compiledArtifactsRetained']
    with tarfile.open(receipts / 'baseline-inputs.tar.gz') as archive:
        files = [m for m in archive.getmembers() if m.isfile()]
        members = {m.name: m for m in files}
        assert len(files) == len(members) == (98 if retained else 49)
        assert sum(m.size for m in files) <= 16 * 1024 * 1024
        for kernel in manifest['kernels']:
            item = artifacts[kernel['id']]
            assert item['originalPtxSha256'] == kernel['originalSha256']
            assert item['recoveredCudaSha256'] == kernel['recoveredSha256']
            for filename, key in [('original.ptx', 'originalSha256'), ('recovered.cu', 'recoveredSha256')]:
                assert digest(bundle / kernel['id'] / filename) == kernel[key]
            assert [case['n'] for case in kernel['cases']] == [0, 1, 2, 7, 31, 33, 65]
            for case in kernel['cases']:
                assert case['capacity'] == case['n'] + 8
                for suffix, key in [('input', 'inputSha256'), ('aux', 'auxSha256'), ('expected', 'expectedSha256')]:
                    path = bundle / kernel['id'] / ('n' + str(case['n']) + '.' + suffix + '.bin')
                    assert digest(path) == case[key], 'frozen input/reference vector changed'
                    vector_files += 1
            extensions = [('sass', 'sassSha256'), ('elf', 'elfSha256')]
            if retained:
                extensions += [('original.cubin', 'originalCubinSha256'), ('recovered.ptx', 'compiledRecoveredPtxSha256')]
            for extension, key in extensions:
                name = 'baseline-inputs/' + kernel['id'] + '.' + extension
                content = archive.extractfile(members[name]).read()
                assert hashlib.sha256(content).hexdigest() == item[key]
                if extension == 'original.cubin':
                    assert content.startswith(b'\x7fELF')
        packed_manifest = json.loads(archive.extractfile(members['baseline-inputs/manifest.json']).read())
        assert packed_manifest['artifacts'] == raw['artifacts']
        assert packed_manifest['architecture'] == expected['architecture']
        if retained:
            assert raw['driverSourceSha256'] == expected['driver'] == packed_manifest['driverSourceSha256']
            assert raw['observedComputeCapability'] == packed_manifest['observedComputeCapability'] == '8.9'
            assert raw['expectedArchitecture'] == expected['architecture']
            mutation = raw['mutationArtifact']
            assert mutation == packed_manifest['mutationArtifact']
            assert mutation['file'] == 'add7_wrap32.mutated.ptx'
            content = archive.extractfile(members['baseline-inputs/' + mutation['file']]).read()
            assert hashlib.sha256(content).hexdigest() == mutation['sha256']
    assert vector_files == 504

    timing = positive['timing']
    assert [r['id'] for r in timing['results']] == ids
    assert timing['warmupsPerVariant'] == 10 and timing['samplesPerVariant'] == 100
    assert timing['pairOrder'] == 'alternating' and timing['unit'] == 'microseconds'
    ratios, regressions = [], []
    for result in timing['results']:
        original, recovered = result['originalSamples'], result['recoveredSamples']
        assert len(original) == len(recovered) == 100
        assert all(math.isfinite(x) and x > 0 for x in original + recovered)
        a, b = sorted(original), sorted(recovered)
        # Nearest-rank quantiles match the frozen C++ evaluator, not interpolated
        # quantiles or an after-the-fact alternative statistic.
        for key, value in [('originalP50', a[49]), ('originalP95', a[94]),
                           ('recoveredP50', b[49]), ('recoveredP95', b[94])]:
            assert abs(result[key] - value) < 1e-8
        ratio = a[49] / b[49]
        assert abs(result['medianSpeedup'] - ratio) < 1e-8
        ratios.append(ratio)
        if b[49] > a[49] * 1.02:
            regressions.append({'id': result['id'], 'originalP50Us': a[49],
                                'recoveredP50Us': b[49],
                                'regressionPercent': (b[49] / a[49] - 1) * 100})
    geometric_speedup = math.exp(sum(math.log(x) for x in ratios) / len(ratios))
    assert abs(geometric_speedup - timing['geometricMeanMedianSpeedup']) < 1e-8
    assert len(regressions) == timing['regressionsAbove2Percent'] == 3
    threshold_met = geometric_speedup >= 1.10 and len(regressions) == 0
    assert timing['meetsProposed10PercentAndNoRegressionThreshold'] == threshold_met

    negative = raw['negative_control']
    assert negative['exitCode'] == 1 and negative['detected'] is True
    assert negative['stderr'] == 'mismatch kernel=add7_wrap32 count=1 variant=1 byte=0 expected=7 actual=8\n'
    memcheck = raw['memcheck']
    assert memcheck['status'] == 'pass' and memcheck['exitCode'] == 0
    assert 'ERROR SUMMARY: 0 errors' in memcheck['stdout']
    checked = json.loads(next(line for line in memcheck['stdout'].splitlines() if line.startswith('{')))
    assert [checked[k] for k in ['kernels', 'cases', 'elementComparisons']] == [24, 72, 2784]
    assert checked['timing']['results'] == []
    commands = raw['commands']
    recovered_compiles = [c for c in commands if c['argv'][0] == 'nvcc' and '-ptx' in c['argv'] and c['argv'][-3].endswith('/recovered.cu')]
    original_compiles = [c for c in commands if c['argv'][0] == 'ptxas' and '-o' in c['argv']]
    assert len(recovered_compiles) == len(original_compiles) == 24
    assert all('-arch=' + expected['architecture'] in c['argv'] for c in recovered_compiles + original_compiles)
    assert all(c['exitCode'] == 0 for c in commands if c['argv'][0] in ['nvcc', 'ptxas', 'cuobjdump'])

    return {
        'schemaVersion': 1, 'audit': 'pass', 'auditScope': 'post-execution consistency, not authentication',
        'attempt': expected['attempt'], 'architecture': expected['architecture'],
        'auditorSha256': digest(Path(__file__)), 'python': sys.version.split()[0],
        'rawReceiptSha256': raw_sha, 'baselineArchiveSha256': archive_sha,
        'kernelCount': 24, 'cases': 168, 'elementComparisons': 9360,
        'compiledRecoveredCudaCount': 24, 'auxiliaryOriginalCubinCompileCount': 24,
        'independentlyRehashedSassElfFiles': 48, 'independentlyRehashedVectorFiles': vector_files,
        'independentlyRehashedRecoveredPtxJitInputs': 24 if retained else 0,
        'independentlyRehashedAuxiliaryCubins': 24 if retained else 0,
        'mutatedPtxHashVerified': retained, 'timingSamples': 4800,
        'geometricMeanMedianSpeedup': geometric_speedup,
        'regressionsAbove2Percent': regressions,
        'performanceThresholdVerdict': 'ACCEPT' if threshold_met else 'REJECT',
        'mutationRejected': True,
        'memcheck': {'cases': 72, 'elementComparisons': 2784, 'errors': 0,
                     'scope': 'counts 0, 1, 33; memcheck only, not racecheck'},
        'workerCompileAndValidationSeconds': raw['elapsed_seconds'],
        'hostTransferAndExecutionSeconds': host['elapsed_seconds'],
        'actualBilledUsd': raw['actual_billed_usd'],
        'limitations': [
            ('Compiled PTX JIT inputs and auxiliary cubins were retained and independently rehashed.' if retained
             else 'Compiled cubin/PTX bytes were not retained; their hashes are worker-observed.'),
            'Driver JIT executes original/recovered PTX. Auxiliary ptxas cubins/SASS/ELF are not the executed JIT machine code.',
            'Executor authentication requires the separate authenticated ruOS completion.',
            'One architecture and small synthetic programs, not real-world SOTA coverage.',
            'Warm host launch plus synchronization latency; allocation, transfer and loading excluded.',
        ],
    }


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: ptx-recovery-receipt-audit.py RECEIPT_DIR FROZEN_BUNDLE_DIR')
    print(json.dumps(audit(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
