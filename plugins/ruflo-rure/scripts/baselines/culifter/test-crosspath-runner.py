#!/usr/bin/env python3
"""Portable runner controls; synthetic subprocesses are not kernel evidence."""
import argparse
import contextlib
import hashlib
import io
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
RUNNER = HERE / 'run-crosspath.py'
SOURCE = None
INPUTS = HERE / 'crosspath-inputs'
CORPUS = None
IDS = ['copy32', 'add7_wrap32', 'multiply_low64', 'wide_signed']
REAL_RUN = subprocess.run


class RunnerControlTests(unittest.TestCase):
    def exercise(self, failed_stage=None, timeout=False, compiler_output=None):
        """Run the real CLI entry point, replacing only subprocess stage results."""
        with tempfile.TemporaryDirectory(prefix='culifter-runner-control-') as directory:
            output = Path(directory) / 'result'
            bindings = {x['id']: x for x in json.loads((INPUTS / 'manifest.json').read_text())['artifacts']}
            observed_compiler = []

            def subprocess_stage(argv, **kwargs):
                out, err, code = '', '', 0
                if argv == ['/usr/bin/g++', '--version']:
                    if compiler_output is None:
                        actual = REAL_RUN(argv, **kwargs)
                        observed_compiler.append(actual.stdout)
                        return actual
                    observed_compiler.append(compiler_output)
                    out = compiler_output
                elif any(str(x).endswith('inspect-crosspath-abi.py') for x in argv):
                    (output / 'parameter-offsets.json').write_text('{}')
                    (output / 'abi-inspection.json').write_text('{"testOnly":true}')
                elif any(str(x).endswith('generate-crosspath.mjs') for x in argv):
                    (output / 'crosspath-drivers.json').write_text(json.dumps({'kernels': [
                        {'id': name, 'sourceSha256': bindings[name]['originalPtxSha256']} for name in IDS
                    ]}))
                else:
                    if any(str(x).endswith('/main.py') for x in argv):
                        stage = 'lift'; name = argv[argv.index('-name') + 1]
                    elif any(str(x).endswith('emit-object.py') for x in argv):
                        stage = 'object'; name = Path(argv[-1]).stem
                    elif argv[0] == '/usr/bin/g++':
                        stage = 'link'; name = Path(argv[-1]).name
                    else:
                        stage = 'execute'; name = Path(argv[0]).name
                    if name == 'copy32' and stage == failed_stage:
                        if timeout:
                            raise subprocess.TimeoutExpired(argv, kwargs['timeout'])
                        code, err = 7, 'injected runner-control failure'
                    elif stage == 'execute':
                        out = json.dumps({'status': 'pass', 'kernel': name, 'cases': 7, 'comparisons': 195})
                return subprocess.CompletedProcess(argv, code, out, err)

            arguments = [str(RUNNER), '--source', str(SOURCE), '--inputs', str(INPUTS),
                         '--corpus', str(CORPUS), '--output', str(output)]
            with patch.object(sys, 'argv', arguments), patch('subprocess.run', side_effect=subprocess_stage), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exited:
                    runpy.run_path(str(RUNNER), run_name='__main__')
            receipt_path = output / 'crosspath-result.json'
            self.assertTrue(receipt_path.is_file(), 'failure must preserve its receipt')
            receipt = json.loads(receipt_path.read_text())
            compiler_bytes = (output / 'native-compiler-version.stdout').read_bytes()
            self.assertEqual(receipt['environment']['nativeCompiler'], observed_compiler[0].rstrip('\n'))
            self.assertEqual(receipt['environment']['nativeCompilerPath'], '/usr/bin/g++')
            self.assertEqual(receipt['environment']['nativeCompilerVersionSha256'], hashlib.sha256(compiler_bytes).hexdigest())
            compiler_rows = [r for r in receipt['runs'] if r['label'] == 'native-compiler-version']
            self.assertEqual(len(compiler_rows), 1)
            self.assertEqual(compiler_rows[0]['argv'], ['/usr/bin/g++', '--version'])
            self.assertEqual(compiler_rows[0]['exitCode'], 0)
            return exited.exception.code, receipt

    def test_all_pass_exits_zero_and_binds_actual_compiler(self):
        code, receipt = self.exercise()
        self.assertEqual(code, 0)
        self.assertEqual(receipt['comparisonCount'], 780)
        self.assertTrue(all(row['state'] == 'passed' for row in receipt['results']))

    def test_failed_stages_preserve_receipt_and_exit_nonzero(self):
        for stage in ['lift', 'object', 'link', 'execute']:
            with self.subTest(stage=stage):
                code, receipt = self.exercise(failed_stage=stage)
                self.assertNotEqual(code, 0)
                self.assertEqual(receipt['results'][0]['state'], stage + '_failed')
                self.assertEqual(receipt['results'][0]['exitCode'], 7)
                self.assertEqual(receipt['comparisonCount'], 585)

    def test_timeout_is_inconclusive_and_nonzero(self):
        code, receipt = self.exercise(failed_stage='execute', timeout=True)
        self.assertNotEqual(code, 0)
        self.assertEqual(receipt['results'][0]['state'], 'inconclusive')
        self.assertIsNone(receipt['results'][0]['exitCode'])

    def test_compiler_report_uses_observed_output_not_hardcoded_version(self):
        output = 'g++ (synthetic provenance fixture, NOT a real compiler) 99.7.1\n'
        code, receipt = self.exercise(compiler_output=output)
        self.assertEqual(code, 0)
        self.assertEqual(receipt['environment']['nativeCompiler'], output.rstrip('\n'))

    def test_sass_and_manifest_substitution_rejected_before_execution(self):
        with tempfile.TemporaryDirectory(prefix='culifter-input-substitution-') as directory:
            root = Path(directory)
            inputs = root / 'inputs'; shutil.copytree(INPUTS, inputs)
            sass = inputs / 'copy32.sass'
            sass.write_bytes(sass.read_bytes() + b'\n')
            manifest_path = inputs / 'manifest.json'
            manifest = json.loads(manifest_path.read_text())
            for row in manifest['artifacts']:
                if row['id'] == 'copy32':
                    row['sassSha256'] = hashlib.sha256(sass.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
            output = root / 'result'
            arguments = [str(RUNNER), '--source', str(SOURCE), '--inputs', str(inputs),
                         '--corpus', str(CORPUS), '--output', str(output)]
            with patch.object(sys, 'argv', arguments), patch('subprocess.run') as execution:
                with self.assertRaisesRegex(ValueError, 'pinned input manifest changed'):
                    runpy.run_path(str(RUNNER), run_name='__main__')
                execution.assert_not_called()
            self.assertFalse((output / 'source').exists())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path,
                        help='separately fetched pinned CuLifter source directory')
    parser.add_argument('--corpus', type=Path,
                        default=HERE.parent.parent / 'fixtures/ptx-recovery/corpus.mjs',
                        help='frozen RuRE corpus (defaults to the repository fixture path)')
    arguments, unittest_arguments = parser.parse_known_args()
    SOURCE = arguments.source.resolve(strict=True)
    CORPUS = arguments.corpus.resolve(strict=True)
    unittest.main(argv=[sys.argv[0], *unittest_arguments])
