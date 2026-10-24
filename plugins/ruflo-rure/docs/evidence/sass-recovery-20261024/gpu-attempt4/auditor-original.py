#!/usr/bin/env python3
"""Replay the observed SASS evaluation's byte and arithmetic checks.

This is an independent post-execution audit, not execution authentication, a new
holdout, a general verifier, or a promotion authority. It does not run a GPU.
"""
if not __debug__:
    raise RuntimeError('Do not use optimized Python: audit assertions are required')
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import tarfile

MODULE = 'd85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3'
DRIVER = 'b192f10ae51c47e338c74531b7238daa801b91aae75c752004b1ee2b0ac2aa05'
EVALUATOR = '2468e244aaed1ed1206f6a42b85f9060a4bcdaad4330a7fcfaf9d09a8c3df94d'
RAW = {'development': '16c5508954f35c938ee0e361c1918ef83f88eac0761d1dc428db66a31eaf1a80',
       'confirmation': '43c8b4a88d2d58ab88afea864b4222c3bcaa3cdb5313f20fbcf568c54d4b0535'}
ARCHIVE = 'b00df4709e9da7bea1d262bfcd1895baf07b3e164008475722504a0397be0750'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--development-supplement', type=Path, required=True)
    args = parser.parse_args()
    base = args.evidence
    manifest = read(base / 'artifact-manifest.json')
    assert len(manifest) == 381
    for name, record in manifest.items():
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        path = base / name
        assert path.is_file() and not path.is_symlink()
        assert path.stat().st_size == record['bytes'] and sha(path) == record['sha256']
    if args.archive:
        assert sha(args.archive) == ARCHIVE
        with tarfile.open(args.archive) as archive:
            members = archive.getmembers()
            assert len(members) == 382 and len(set(m.name for m in members)) == 382
            for member in members:
                assert member.isfile() and not member.name.startswith('/') and '..' not in Path(member.name).parts
                assert archive.extractfile(member).read() == (base / member.name).read_bytes()
    assert sha(base / 'candidate.mjs') == MODULE
    assert sha(base / 'sass-recovery-translate.mjs') == 'a464137ae041c469d8a9292421b3f833d0fbc41fbb731f7503042ae3d594f353'
    evaluator = Path(__file__).with_name('sass-recovery-e2e.mjs')
    assert sha(evaluator) == EVALUATOR == sha(base / 'evaluator/sass-recovery-e2e.mjs')
    program = 'import {oracleSet} from ' + json.dumps(evaluator.as_uri()) + ';process.stdout.write(JSON.stringify({development:await oracleSet("development"),confirmation:await oracleSet("confirmation")}))'
    oracle_run = subprocess.run(['node', '--input-type=module', '-e', program], capture_output=True, text=True,
                                timeout=10, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C'})
    assert oracle_run.returncode == 0
    oracles = json.loads(oracle_run.stdout)
    supplement = args.development_supplement
    supplemental_manifest = read(supplement / 'manifest.json')
    assert len(supplemental_manifest) == 28
    for name, record in supplemental_manifest.items():
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        path = supplement / name
        assert path.stat().st_size == record['bytes'] and sha(path) == record['sha256']
    development_translation = read(supplement / 'translation/translation-result.json')
    development_cpu = read(supplement / 'cpu/cpu-receipt.json')
    assert sha(supplement / 'translation/translation-result.json') == '1185a4050bf86f131ed8e2bb21280048572088556896c1aaa4e7ba444fc3ea3a'
    assert sha(supplement / 'cpu/cpu-receipt.json') == '66ef6461714c383dca69e35a61442170ba5999a13fca5c3847a5789bdd4f0c6b'
    assert development_translation['moduleSha256'] == MODULE and development_translation['coverage'] == {'total':4,'emitted':4,'unsupported':0,'invalid':0}
    assert development_cpu['status'] == 'pass' and development_cpu['cases'] == 28 and development_cpu['elementComparisons'] == 780
    for row in development_translation['kernels']:
        assert sha(supplement / 'translation' / row['id'] / 'recovery.json') == row['recoverySha256']
        assert sha(supplement / 'translation' / row['id'] / 'recovered.cu') == row['codeSha256']
        observed = next(r for r in development_cpu['kernels'] if r['id'] == row['id'])
        assert observed['status'] == 'pass' and observed['execution']['execute']['exitCode'] == 0 and observed['negativeControl']['execute']['exitCode'] == 1
    translation_root = base / 'translation-output/translation'
    translation = read(translation_root / 'translation-result.json')
    cpu = read(base / 'evaluation-output/cpu/cpu-receipt.json')
    frozen = read(base / 'native-freeze.json')
    assert translation['moduleSha256'] == MODULE and translation['coverage'] == {'total': 6, 'emitted': 5, 'unsupported': 1, 'invalid': 0}
    assert frozen['nativeManifestSha256'] == sha(base / 'native/native-manifest.json') == '53f85b394e5e6d60c472878ea3f0cfece3d052b086a89bf882f902c63c00558e'
    assert frozen['translationInputManifestSha256'] == translation['inputManifestSha256'] == 'd832f654f51d6155bda360bf947a0d88392166f52c83b48244b511439775bd98'
    from datetime import datetime
    assert datetime.fromisoformat(translation['startedAt'].replace('Z', '+00:00')).timestamp() > frozen['operatorFrozenAt']
    assert cpu['status'] == 'coverage-incomplete' and cpu['cases'] == 30 and cpu['elementComparisons'] == 840
    assert cpu['translationReceiptSha256'] == sha(translation_root / 'translation-result.json')
    for row in translation['kernels']:
        assert sha(translation_root / row['id'] / 'recovery.json') == row['recoverySha256']
        result = read(translation_root / row['id'] / 'recovery.json')
        assert result['status'] == row['status']
        if row['status'] == 'emitted':
            assert sha(translation_root / row['id'] / 'recovered.cu') == row['codeSha256']
            observed = next(x for x in cpu['kernels'] if x['id'] == row['id'])
            assert observed['status'] == 'pass' and observed['execution']['execute']['exitCode'] == 0
            assert observed['negativeControl']['execute']['exitCode'] == 1
        else:
            assert row['id'] == 'confirm_d29' and result['code'] is None
    summaries = []
    vector_count = 0
    for split, raw_hash in RAW.items():
        raw = base / (split + '-gpu-result.json')
        assert sha(raw) == raw_hash
        receipt = read(raw)
        bundle = base / (split + '-gpu-input')
        exports = base / (split + '-artifacts')
        native = base / ('development-native' if split == 'development' else 'native')
        policy = read(bundle / 'gpu-manifest.json')
        lock_path = base / ('execution-lock-' + split + '.json')
        lock = read(lock_path)
        assert receipt['executionLockSha256'] == sha(lock_path)
        assert lock['gpuManifestSha256'] == sha(bundle / 'gpu-manifest.json')
        assert lock['nativeManifestSha256'] == sha(native / 'native-manifest.json') == policy['nativeManifestSha256']
        assert policy['moduleSha256'] == MODULE and policy['driverSha256'] == DRIVER
        if split == 'development':
            assert policy['translationReceiptSha256'] == sha(supplement / 'translation/translation-result.json')
            assert policy['cpuReceiptSha256'] == sha(supplement / 'cpu/cpu-receipt.json')
        else:
            assert policy['translationReceiptSha256'] == sha(translation_root / 'translation-result.json')
            assert policy['cpuReceiptSha256'] == sha(base / 'evaluation-output/cpu/cpu-receipt.json')
        assert receipt['gpuManifest'] == policy and receipt['coverage'] == policy['coverage']
        assert receipt['postExecutionBinaryBindingVerified'] is True and receipt['executionStatus'] == 'pass'
        assert sha(exports / 'compiled-driver') == receipt['compiledDriverSha256']
        assert sha(exports / 'sass-recovery-gpu.cu') == DRIVER
        assert (exports / 'compiled-driver').read_bytes()[:4] == b'\x7fELF'
        assert read(exports / 'execution-manifest.json')['artifacts'] == receipt['artifacts']
        expected_ids = [k['id'] for k in oracles[split]['kernels'] if k['id'] != 'confirm_d29']
        assert [k['id'] for k in policy['kernels']] == expected_ids
        assert (bundle / 'kernels.txt').read_text().splitlines() == expected_ids
        coverage = policy['coverage']
        assert coverage['frozenKernelCount'] == len(oracles[split]['kernels'])
        assert coverage['admittedKernelCount'] == len(expected_ids) and coverage['promotionEligible'] is False
        assert coverage['status'] == ('complete' if split == 'development' else 'partial-incomplete')
        cases = comparisons = 0
        for row in policy['kernels']:
            name = row['id']
            oracle = next(k for k in oracles[split]['kernels'] if k['id'] == name)
            artifact = next(k for k in receipt['artifacts'] if k['id'] == name)
            native_row = next(k for k in read(native / 'native-manifest.json')['kernels'] if k['id'] == name)
            case_file = bundle / name / 'case.txt'
            assert sha(case_file) == row['caseSha256']
            lines = case_file.read_text().splitlines()
            assert lines[0] == f"{name} rure_sass_kernel_0 {oracle['inputBits']} {oracle['outputBits']}"
            assert len(lines) == len(oracle['cases']) + 1
            for index, vector in enumerate(oracle['cases']):
                n = vector['count']
                assert lines[index + 1] == f"{n} {vector['scalar']} {len(vector['input'])} {len(vector['expected'])} {int(index == len(oracle['cases'])-1)}"
                for kind in ['input', 'aux', 'expected']:
                    bits = oracle['outputBits'] if kind == 'expected' else oracle['inputBits']
                    expected = b''.join(struct.pack('<I' if bits == 32 else '<Q', int(x)) for x in vector[kind])
                    filename = f'n{n}.{kind}.bin'
                    assert (bundle / name / filename).read_bytes() == expected
                    assert sha(bundle / name / filename) == row['files'][filename]
                    vector_count += 1
                cases += 1
                comparisons += 2 * len(vector['expected'])
            for suffix, field in [('original.cubin','originalCubinSha256'), ('recovered.cubin','recoveredCubinSha256'), ('recovered.cu','recoveredCudaSha256'), ('sass','sassSha256'), ('elf','elfSha256')]:
                assert sha(exports / (name + '.' + suffix)) == artifact[field]
            assert artifact['originalCubinSha256'] == row['originalCubinSha256'] == native_row['cubinSha256']
            assert artifact['sassSha256'] == native_row['sassSha256'] and artifact['elfSha256'] == native_row['elfSha256']
            assert artifact['recoveredCudaSha256'] == row['recoveredCudaSha256'] == sha(bundle / name / 'recovered.cu')
            for kind in ['original', 'recovered']:
                assert (exports / f'{name}.{kind}.cubin').read_bytes()[:4] == b'\x7fELF'
            if split == 'confirmation':
                assert artifact['recoveredCudaSha256'] == sha(translation_root / name / 'recovered.cu')
            else:
                assert artifact['recoveredCudaSha256'] == sha(supplement / 'translation' / name / 'recovered.cu')
        positive = receipt['positive']
        assert positive['kernels'] == len(expected_ids) and positive['cases'] == cases and positive['elementComparisons'] == comparisons
        assert policy['expected'] == {'kernels': len(expected_ids), 'cases': cases, 'elementComparisonsBothVariants': comparisons}
        assert 'ERROR SUMMARY: 0 errors' in receipt['memcheckLog']
        instrumented = [json.loads(line) for line in receipt['memcheckLog'].splitlines() if line.startswith('{')]
        assert len(instrumented) == 1 and instrumented[0]['cases'] == cases and instrumented[0]['elementComparisons'] == comparisons
        timing = positive['timing']
        assert timing['warmupsPerVariant'] == 10 and timing['samplesPerVariant'] == 100 and timing['pairOrder'] == 'alternating'
        assert [r['id'] for r in timing['results']] == expected_ids
        ratios = []; regressions = []; per_kernel = []
        for row in timing['results']:
            arrays = [row['originalSamples'], row['recoveredSamples']]
            assert all(len(a) == 100 and all(isinstance(v,(int,float)) and math.isfinite(v) and v > 0 for v in a) for a in arrays)
            p50 = [sorted(a)[49] for a in arrays]; p95 = [sorted(a)[94] for a in arrays]
            assert p50 == [row['originalP50'], row['recoveredP50']] and p95 == [row['originalP95'], row['recoveredP95']]
            ratio = p50[0] / p50[1]; ratios.append(ratio)
            assert abs(ratio - row['medianSpeedup']) < 1e-8
            if p50[1] > p50[0] * 1.02: regressions.append(row['id'])
            per_kernel.append({'id':row['id'],'originalP50':p50[0],'recoveredP50':p50[1],'originalP95':p95[0],'recoveredP95':p95[1]})
        geometric = math.exp(sum(map(math.log,ratios)) / len(ratios))
        assert abs(geometric - timing['geometricMeanMedianSpeedup']) < 1e-8
        assert len(regressions) == timing['regressionsAbove2Percent']
        assert timing['meetsProposed10PercentAndNoRegressionThreshold'] == (geometric >= 1.10 and not regressions)
        if split == 'development':
            mutation = receipt['negativeControl']
            assert mutation['exitCode'] == 1 and 'variant=1' in mutation['log'] and 'expected=7' in mutation['log'] and 'actual=8' in mutation['log']
            assert sha(exports / 'add7_wrap32.mutated.cubin') == mutation['mutatedCubinSha256']
            original = (bundle / 'add7_wrap32/recovered.cu').read_text()
            mutated = (bundle / 'add7_wrap32/mutated.cu').read_text()
            assert original.count('0x7ULL') == 1 and mutated == original.replace('0x7ULL','0x8ULL')
            assert sha(bundle / 'add7_wrap32/mutated.cu') == mutation['mutatedCudaSha256']
        summaries.append({'split':split,'rawSha256':raw_hash,'frozenKernels':coverage['frozenKernelCount'],'admittedKernels':len(expected_ids),'cases':cases,'elementComparisons':comparisons,'rawTimingSamples':200*len(expected_ids),'geometricMedianSpeedup':geometric,'regressionsAbove2Percent':regressions,'performanceGate':geometric>=1.10 and not regressions,'workerElapsedSeconds':receipt['elapsedSeconds'],'perKernelTimingUs':per_kernel})
    lifecycle = read(base / 'lifecycle-projection.json')
    assert lifecycle['cleanup']['verified_absent'] and lifecycle['reconciliation']['exact_instance_absent'] and lifecycle['reconciliation']['label_absent'] and lifecycle['reconciliation']['total_instances'] == 0
    output = {'status':'pass','scope':'byte bindings and arithmetic rederived; no GPU rerun or execution authentication',
              'auditorSha256':sha(Path(__file__)),'archiveSha256':ARCHIVE,'artifactFilesVerified':381,'vectorFilesVerified':vector_count,
              'originalDevelopmentSupplementFilesVerified':28,'originalDevelopmentReceiptsMatchGpuManifest':True,
              'sourceRecoveryCoverageVerdict':'INCONCLUSIVE: 5/6 confirmation; unsupported d29 retained',
              'optimizationVerdict':'REJECT: neither frozen 10 percent gate met','actualBilledUsd':None,
              'confirmationStartedAt':translation['startedAt'],'nativeFrozenAt':frozen['operatorFrozenAt'],
              'firstExposureOnly':'one recorded confirmation translation; later checks only inspect saved artifacts',
              'results':summaries,'lifecycleProjection':lifecycle,
              'limitations':['Post-execution JSON and hashes are not execution authentication.','Original per-split gzip containers are represented by recorded hashes; this audit verifies their retained member bytes in a checked xz repack.','GPU results cover admitted synthetic integer kernels only; the excluded sixth kernel is not counted as executed.','Timing excludes provisioning, compilation, allocation and transfers; clocks were not locked.']}
    print(json.dumps(output,indent=2))


if __name__ == '__main__':
    main()
