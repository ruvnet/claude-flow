#!/usr/bin/env python3
"""Synthetic adapter/control tests, never independent benchmark observations."""
import argparse
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SOURCE = None
REAL_RUN = subprocess.run


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


DRIVER = load('generate-driver')
RUNNER = load('run-equal-input')


def abi():
    return {'parameters': [{'ordinal': i, 'offset': offset, 'size': size} for i, (offset, size) in
                           enumerate([(352, 8), (360, 8), (368, 8), (376, 4), (384, 8)])],
            'specialRegisters': {'SR_NTID.X': 0, 'SR_NTID.Y': 4, 'SR_NTID.Z': 8,
                                 'SR_GRID_DIM.X': 12, 'SR_GRID_DIM.Y': 16, 'SR_GRID_DIM.Z': 20,
                                 'SR_CTAID.X': 32, 'SR_TID.X': 44, 'SR_LANEID': 56}}


def synthetic_oracle(name='synthetic_copy', bits=32):
    cases = []
    modulus = 1 << bits
    for n in [0, 1, 3, 17, 32, 67]:
        values = [str((modulus - 2 + i * 17) % modulus) for i in range(2 * n + 8)]
        sentinel = str(modulus - 7)
        cases.append({'count': n, 'scalar': '3', 'input': values, 'aux': ['0'] * (2 * n + 8),
                      'sentinel': sentinel,
                      'expected': [str((int(x) + 3) % modulus) for x in values[:n]] + [sentinel] * 8})
    return {'id': name, 'inputBits': bits, 'outputBits': bits, 'cases': cases}


class DriverTests(unittest.TestCase):
    def compile_and_run(self, bits, mutation=0):
        oracle = synthetic_oracle(bits=bits)
        code, expected = DRIVER.generate(DRIVER.normalize_oracle(oracle, oracle['id']), abi())
        stub = '''
template<class T> static T read(unsigned o){T v;memcpy(&v,&const_mem[0][o],sizeof(v));return v;}
extern "C" void synthetic_copy(){
  unsigned i=read<unsigned>(32)*read<unsigned>(0)+read<unsigned>(44);
  if(read<unsigned>(4)!=1 || read<unsigned>(8)!=1 || read<unsigned>(16)!=1 || read<unsigned>(20)!=1) return;
  if(i>=read<unsigned>(376)) return;
  auto input=(uintBITS_t*)(uintptr_t)read<uint64_t>(352);
  auto output=(uintBITS_t*)(uintptr_t)read<uint64_t>(368);
  output[i]=uintBITS_t(input[i]+read<uint64_t>(384)+MUTATION);
}
'''.replace('BITS', str(bits)).replace('MUTATION', str(mutation))
        with tempfile.TemporaryDirectory(prefix='culifter-synthetic-driver-') as directory:
            root = Path(directory); path = root / 'test.cpp'; path.write_text(code + stub)
            compiled = REAL_RUN(['/usr/bin/g++', '-std=c++20', '-O2', str(path), '-o', str(root / 'test')], capture_output=True, text=True, timeout=30)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            observed = REAL_RUN([str(root / 'test')], capture_output=True, text=True, timeout=5)
        return observed, expected

    def test_integer_widths_and_guard_comparisons(self):
        for bits in [32, 64]:
            with self.subTest(bits=bits):
                observed, expected = self.compile_and_run(bits)
                self.assertEqual(observed.returncode, 0, observed.stdout)
                self.assertEqual(json.loads(observed.stdout), {'status': 'pass', **expected})
                self.assertEqual(expected['comparisons'], 168)

    def test_mutated_native_result_rejected(self):
        observed, _ = self.compile_and_run(32, mutation=1)
        self.assertNotEqual(observed.returncode, 0)
        self.assertIn('FAIL synthetic_copy count_1', observed.stdout)

    def test_argument_overlap_and_bad_data_rejected(self):
        kernel = DRIVER.normalize_oracle(synthetic_oracle(), 'synthetic_copy')
        altered = abi(); altered['parameters'][1]['offset'] = 352
        with self.assertRaisesRegex(ValueError, 'overlapping'):
            DRIVER.generate(kernel, altered)
        altered = abi(); altered['specialRegisters']['SR_GRID_DIM.X'] = 0
        with self.assertRaisesRegex(ValueError, 'overlapping special registers'):
            DRIVER.generate(kernel, altered)
        kernel['cases'][0]['buffers']['input']['values'][0] = '0;malicious()'
        with self.assertRaisesRegex(ValueError, 'unsigned decimal'):
            DRIVER.generate(kernel, abi())


class RunnerTests(unittest.TestCase):
    def test_nonregular_oversized_and_growing_inputs_rejected(self):
        with tempfile.TemporaryDirectory(prefix='culifter-bounded-input-') as directory:
            root = Path(directory)
            fifo = root / 'fifo'; os.mkfifo(fifo)
            with self.assertRaisesRegex(ValueError, 'regular file'):
                RUNNER.read_bound(fifo, hashlib.sha256(b'').hexdigest(), maximum=64)
            path = root / 'large'; path.write_bytes(b'x' * 65)
            with self.assertRaisesRegex(ValueError, 'size outside scope'):
                RUNNER.read_bound(path, hashlib.sha256(path.read_bytes()).hexdigest(), maximum=64)
            fake_stat = SimpleNamespace(st_mode=path.stat().st_mode, st_size=0)
            with patch.object(RUNNER.os, 'fstat', return_value=fake_stat):
                with self.assertRaisesRegex(ValueError, 'grew beyond size limit'):
                    RUNNER.read_bound(path, hashlib.sha256(path.read_bytes()).hexdigest(), maximum=64)

    def fixture(self, root):
        inputs, oracles = root / 'inputs', root / 'oracles'
        inputs.mkdir(); oracles.mkdir()
        artifacts, approved = [], []
        for i in range(6):
            name = 'control_' + str(i)
            oracle = oracles / (name + '.oracle.json'); oracle.write_text(json.dumps(synthetic_oracle(name)))
            item = {'id': name, 'symbol': name}
            for suffix in ['sass', 'elf']:
                data = ('SYNTHETIC RUNNER CONTROL ONLY: ' + name + '.' + suffix).encode()
                (inputs / (name + '.' + suffix)).write_bytes(data)
                item[suffix + 'Sha256'] = hashlib.sha256(data).hexdigest()
            artifacts.append(item)
            approved.append({'id': name, 'symbol': name, 'oracleSha256': hashlib.sha256(oracle.read_bytes()).hexdigest()})
        manifest = inputs / 'manifest.json'; manifest.write_text(json.dumps({'architecture': 'sm_86', 'artifacts': artifacts}))
        policy = {'schemaVersion': 1, 'independentPlanSha256': RUNNER.PLAN_SHA,
                  'inputManifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest(), 'kernels': approved,
                  'evaluatorHashes': {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in RUNNER.EVALUATORS}}
        policy_path = root / 'policy.json'; policy_path.write_text(json.dumps(policy))
        return inputs, oracles, policy_path

    def exercise(self, stage_failure=None, timeout=False, forged=False, tamper=None):
        with tempfile.TemporaryDirectory(prefix='culifter-equal-control-') as directory:
            root = Path(directory); inputs, oracles, policy_path = self.fixture(root)
            policy_hash = hashlib.sha256(policy_path.read_bytes()).hexdigest()
            if tamper == 'manifest':
                sass = inputs / 'control_0.sass'; sass.write_bytes(sass.read_bytes() + b'changed')
                path = inputs / 'manifest.json'; manifest = json.loads(path.read_text())
                manifest['artifacts'][0]['sassSha256'] = hashlib.sha256(sass.read_bytes()).hexdigest(); path.write_text(json.dumps(manifest))
            if tamper == 'oracle':
                path = oracles / 'control_0.oracle.json'; path.write_text(path.read_text() + '\n')
            output = root / 'output'
            calls = []

            def stage(argv, **kwargs):
                calls.append(argv)
                if argv == ['/usr/bin/g++', '--version']:
                    if stage_failure == 'compiler':
                        return subprocess.CompletedProcess(argv, 7, '', 'injected compiler unavailability')
                    return REAL_RUN(argv, **kwargs)
                if any(str(x).endswith('inspect-abi.py') for x in argv):
                    label = 'abi'; name = argv[argv.index('--symbol') + 1]
                    Path(argv[argv.index('--output') + 1]).write_text(json.dumps(abi()))
                    if name == 'control_0' and stage_failure == 'scope':
                        Path(argv[argv.index('--output') + 1]).write_text(json.dumps({'state': 'unsupported_scope', 'reason': 'synthetic scope control'}))
                        return subprocess.CompletedProcess(argv, 2, '', '')
                    stdout = '{}'
                elif any(str(x).endswith('generate-driver.py') for x in argv):
                    label = 'driver'; name = argv[argv.index('--symbol') + 1]
                    stdout = json.dumps({'expected': {'kernel': name, 'cases': 6, 'comparisons': 168}, 'driverSha256': '0' * 64})
                elif any(str(x).endswith('/main.py') for x in argv):
                    label = 'lift'; name = argv[argv.index('-name') + 1]; stdout = ''
                elif any(str(x).endswith('emit-object.py') for x in argv):
                    label = 'object'; name = Path(argv[-1]).stem; stdout = ''
                elif argv[0] == '/usr/bin/g++':
                    label = 'link'; name = Path(argv[-1]).name; stdout = ''
                else:
                    label = 'execute'; name = Path(argv[0]).name
                    stdout = json.dumps({'status': 'pass', 'kernel': name, 'cases': 6, 'comparisons': 999999 if forged and name == 'control_0' else 168})
                if name == 'control_0' and label == stage_failure:
                    if timeout:
                        raise subprocess.TimeoutExpired(argv, 60)
                    return subprocess.CompletedProcess(argv, 7, '', 'injected control failure')
                return subprocess.CompletedProcess(argv, 0, stdout, '')

            arguments = [str(HERE / 'run-equal-input.py'), '--source', str(SOURCE), '--inputs', str(inputs), '--oracles', str(oracles),
                         '--policy', str(policy_path), '--policy-sha256', policy_hash, '--output', str(output)]
            with patch.object(sys, 'argv', arguments), patch('subprocess.run', side_effect=stage), contextlib.redirect_stdout(io.StringIO()):
                if tamper:
                    with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                        runpy.run_path(str(HERE / 'run-equal-input.py'), run_name='__main__')
                    self.assertEqual(calls, []); self.assertFalse(output.exists())
                    return None, None
                with self.assertRaises(SystemExit) as exited:
                    runpy.run_path(str(HERE / 'run-equal-input.py'), run_name='__main__')
            receipt = json.loads((output / 'equal-input-result.json').read_text())
            actual = REAL_RUN(['/usr/bin/g++', '--version'], capture_output=True, text=True, check=True)
            self.assertEqual(receipt['environment']['nativeCompiler'], '' if stage_failure == 'compiler' else actual.stdout.rstrip('\n'))
            return exited.exception.code, receipt

    def test_success_control(self):
        code, receipt = self.exercise()
        self.assertEqual(code, 0)
        self.assertEqual(receipt['measuredComparisonCount'], 1008)

    def test_failed_stages_and_timeout_keep_unknown_accuracy(self):
        for stage in ['abi', 'driver', 'lift', 'object', 'link', 'execute']:
            with self.subTest(stage=stage):
                code, receipt = self.exercise(stage_failure=stage)
                self.assertNotEqual(code, 0)
                self.assertIsNone(receipt['semanticAccuracy'])
                self.assertIsNone(receipt['results'][0]['semanticAccuracy'])
                self.assertEqual(receipt['measuredComparisonCount'], 840)
        code, receipt = self.exercise(stage_failure='execute', timeout=True)
        self.assertNotEqual(code, 0); self.assertEqual(receipt['results'][0]['state'], 'inconclusive')

    def test_forged_counts_rejected(self):
        code, receipt = self.exercise(forged=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(receipt['results'][0]['state'], 'invalid_result')

    def test_unsupported_and_unavailable_are_not_zero_accuracy(self):
        code, receipt = self.exercise(stage_failure='scope')
        self.assertNotEqual(code, 0)
        self.assertEqual(receipt['results'][0]['state'], 'unsupported_scope')
        self.assertIsNone(receipt['semanticAccuracy'])
        code, receipt = self.exercise(stage_failure='compiler')
        self.assertNotEqual(code, 0)
        self.assertIsNone(receipt['semanticAccuracy'])
        self.assertEqual(receipt['measuredComparisonCount'], 0)
        self.assertTrue(all(result['semanticAccuracy'] is None for result in receipt['results']))

    def test_manifest_and_oracle_substitution_rejected_before_execution(self):
        self.exercise(tamper='manifest')
        self.exercise(tamper='oracle')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    arguments, extra = parser.parse_known_args()
    SOURCE = arguments.source.resolve(strict=True)
    unittest.main(argv=[sys.argv[0], *extra])
