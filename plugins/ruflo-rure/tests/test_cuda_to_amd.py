import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / 'scripts/cuda_to_amd.py'
spec = importlib.util.spec_from_file_location('pipeline', SCRIPT)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class PipelineTests(unittest.TestCase):
    def value(self, **changes):
        v=dict(backend='hip',size=257,checked=257,device='test device',max_abs_error=0,milliseconds=1)
        v.update(changes)
        return v

    def test_numeric_and_identity_failures(self):
        for changes in [dict(milliseconds=float('nan')),dict(max_abs_error=float('inf')),dict(milliseconds=0),dict(checked=256),dict(backend='cpu'),dict(max_abs_error=.1),dict(device='')]:
            with self.subTest(changes=changes), self.assertRaises(p.PipelineError):
                p.validate_measurement(self.value(**changes),'hip',257,1e-5)
        self.assertEqual(p.validate_measurement(self.value(),'hip',257,1e-5),1)

    def test_timeout_and_nonzero(self):
        with tempfile.TemporaryDirectory() as d:
            runner=p.Runner(d,2,.1)
            with self.assertRaisesRegex(p.PipelineError,'timeout'):
                runner.call([sys.executable,'-c','import time;time.sleep(5)'],'sleep')
            with self.assertRaises(p.PipelineError):
                runner.call([sys.executable,'-c','raise SystemExit(2)'],'failure')

    def test_output_cap(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(p.PipelineError):
                p.Runner(d,5,2).call([sys.executable,'-c','print("x"*3000000)'],'large')

    def args(self,d,**changes):
        source=Path(d)/'source.cu';source.write_text('trusted source fixture')
        a=dict(output=str(Path(d)/'run'),source=str(source),allow_execute=True,budget=10,timeout=2,
               nvcc='missing-nvcc-test-123',hipcc='hipcc',hipify='hipify-perl',ruflo=None,
               tolerance=1e-5,sizes=[257],trials=3,blocks=[128,256],max_slowdown=1.25)
        a.update(changes)
        return SimpleNamespace(**a)

    def test_missing_tool_blocks_with_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.args(d); result=p.run(args)
            self.assertEqual(result['status'],'blocked')
            self.assertFalse(result['hardware_validated'])
            self.assertTrue((Path(args.output)/'report.json').exists())

    def test_execution_requires_opt_in(self):
        with tempfile.TemporaryDirectory() as d, patch.object(p.Runner,'call') as call:
            result=p.run(self.args(d,allow_execute=False))
            call.assert_not_called()
            self.assertEqual(result['status'],'blocked')

    def test_existing_workspace_refused(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.args(d);Path(args.output).mkdir()
            with self.assertRaises(FileExistsError):p.run(args)

    def test_simulated_orchestration_and_rejection(self):
        # Explicitly mocked control-flow test: NOT evidence of GPU execution.
        for slow in [False, True]:
            with tempfile.TemporaryDirectory() as d:
                args=self.args(d)
                def call(runner,argv,stage):
                    if stage.startswith('build'):
                        Path(argv[-1]).write_text('simulated binary')
                    if stage=='hipify':return 'simulated HIP source'
                    if stage.startswith('benchmark'):
                        backend=stage.split('-')[1]
                        return json.dumps(self.value(backend=backend,milliseconds=3 if slow and backend=='hip' else 1))
                    return 'simulated version'
                with patch.object(p.Runner,'call',call):result=p.run(args)
                self.assertEqual(result['status'],'rejected' if slow else 'passed')
                self.assertEqual(len(result['measurements']),12)
                self.assertEqual(len(result['candidates']),2)

    def test_split_receipts_reject_tampering_and_policy_drift(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.args(d,stage='cuda')
            def call(runner,argv,stage):
                if stage=='build-cuda':Path(argv[-1]).write_text('test binary')
                if stage=='benchmark-cuda':return json.dumps(self.value(backend='cuda'))
                return 'test version'
            with patch.object(p.Runner,'call',call):receipt=p.run(args)
            self.assertEqual(receipt['status'],'baseline_ready')
            self.assertFalse(receipt['hardware_validated'])
            path=Path(args.output)/'report.json'; hashed=p.digest(path.read_bytes())
            medians,_=p.import_baseline(path,hashed,receipt['source_sha256'],receipt['policy'])
            self.assertEqual(medians,{257:1})
            for source,policy,sha in [('wrong',receipt['policy'],hashed),(receipt['source_sha256'],{},hashed),(receipt['source_sha256'],receipt['policy'],'wrong')]:
                with self.assertRaises(p.PipelineError):p.import_baseline(path,sha,source,policy)
            receipt['measurements'].pop()
            path.write_text(json.dumps(receipt))
            with self.assertRaises(p.PipelineError):p.import_baseline(path,p.digest(path.read_bytes()),receipt['source_sha256'],receipt['policy'])

    def test_split_hip_stage_uses_no_cuda_toolchain(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.args(d,stage='cuda')
            stages=[]
            def call(runner,argv,stage):
                stages.append(stage)
                if stage.startswith('build'):Path(argv[-1]).write_text('test binary')
                if stage=='hipify':return 'test translated source'
                if stage.startswith('benchmark'):return json.dumps(self.value(backend=stage.split('-')[1]))
                return 'test version'
            with patch.object(p.Runner,'call',call):baseline=p.run(args)
            path=Path(args.output)/'report.json'
            args.stage='hip';args.baseline=str(path);args.baseline_sha256=p.digest(path.read_bytes());args.output=str(Path(d)/'amd')
            stages.clear()
            with patch.object(p.Runner,'call',call):result=p.run(args)
            self.assertEqual(result['status'],'passed')
            self.assertNotIn('build-cuda',stages)
            self.assertNotIn('benchmark-cuda',stages)
            self.assertEqual(len(result['dispersion']),2)

if __name__=='__main__':unittest.main()
