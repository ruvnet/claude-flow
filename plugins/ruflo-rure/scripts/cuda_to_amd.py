#!/usr/bin/env python3
"""Explicit-execution CUDA to HIP pipeline. Python standard library only."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import shutil
import statistics
import subprocess
import tempfile
import time


class PipelineError(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def finite(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
        raise PipelineError(f'invalid {name}')
    return value


def validate_measurement(value, backend, size, tolerance):
    if not isinstance(value, dict) or value.get('backend') != backend or value.get('size') != size:
        raise PipelineError('backend or workload mismatch')
    if not isinstance(value.get('device'), str) or not value['device'].strip():
        raise PipelineError('missing device identity')
    if type(value.get('size')) is not int or type(value.get('checked')) is not int or value.get('checked') != size:
        raise PipelineError('incomplete correctness check')
    error = finite(value.get('max_abs_error'), 'error')
    elapsed = finite(value.get('milliseconds'), 'milliseconds', 1e-9)
    if error > tolerance:
        raise PipelineError(f'correctness failed: {error} > {tolerance}')
    return elapsed


class Runner:
    def __init__(self, root, budget, timeout):
        self.root, self.deadline, self.timeout = root, time.monotonic() + budget, timeout
        self.events = []

    def call(self, argv, stage):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise PipelineError('wall time budget exhausted')
        start = time.monotonic()
        # Disk-backed capture avoids unbounded RAM; output is capped while polling.
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            try:
                p = subprocess.Popen(argv, cwd=self.root, stdout=out, stderr=err, start_new_session=True)
            except OSError as exc:
                raise PipelineError(f'{stage}: {exc}') from exc
            limit = min(remaining, self.timeout)
            reason = None
            while p.poll() is None:
                if time.monotonic() - start > limit:
                    reason = 'timeout'
                if os.fstat(out.fileno()).st_size + os.fstat(err.fileno()).st_size > 2_000_000:
                    reason = 'output cap'
                if reason:
                    os.killpg(p.pid, signal.SIGKILL)
                    p.wait()
                    break
                time.sleep(.02)
            # Kill any descendants that outlive the direct process.
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            out.seek(0); err.seek(0)
            stdout, stderr = out.read(2_000_001), err.read(2_000_001)
        self.events.append({'stage': stage, 'argv': argv, 'exit_code': p.returncode,
                            'seconds': time.monotonic() - start,
                            'stdout_sha256': digest(stdout), 'stderr_sha256': digest(stderr)})
        if reason or p.returncode or len(stdout) + len(stderr) > 2_000_000:
            raise PipelineError(f'{stage}: {reason or "command failed"}; {stderr[:2000].decode(errors="replace")}')
        return stdout.decode('utf-8')


def run(args):
    report = {'schema': 1, 'status': 'blocked', 'hardware_validated': False,
              'execution': 'real', 'events': [], 'measurements': [], 'candidates': []}
    root = Path(args.output).resolve()
    # Never overwrite a prior run or follow an existing output symlink.
    root.mkdir(parents=True, exist_ok=False)
    runner = Runner(root, args.budget, args.timeout)
    report['events'] = runner.events
    try:
        if not args.allow_execute:
            raise PipelineError('execution requires --allow-execute for trusted source and tools')
        source = Path(args.source).resolve()
        data = source.read_bytes()
        if not data or len(data) > 1_000_000:
            raise PipelineError('source must contain 1..1000000 bytes')
        report['source_sha256'] = digest(data)
        report['policy'] = {'budget_seconds': args.budget, 'command_timeout_seconds': args.timeout,
                            'tolerance': args.tolerance, 'sizes': args.sizes, 'trials': args.trials,
                            'blocks': args.blocks, 'max_slowdown': args.max_slowdown}
        frozen = root / 'baseline.cu'
        frozen.write_bytes(data)
        report['toolchains'] = []
        for tool in [args.nvcc, args.hipcc, args.hipify]:
            version = runner.call([tool, '--version'], 'preflight')
            report['toolchains'].append({'executable': shutil.which(tool), 'version': version[:8192]})
        runner.call([args.nvcc, '-O3', str(frozen), '-o', str(root / 'baseline')], 'build-cuda')
        # inspect optional RuRE evidence; no claim that inspection establishes correctness.
        if args.ruflo:
            report['cuda_inventory'] = runner.call([args.ruflo, 'mcp', 'exec', '-t', 'rure_analyze_cuda', '-p', json.dumps({'path': str(root / 'baseline')})], 'inspect-cuda')
        translated = runner.call([args.hipify, str(frozen)], 'hipify')
        if not translated.strip():
            raise PipelineError('HIPIFY returned empty source')
        hip = root / 'candidate.hip.cpp'
        hip.write_text(translated)
        report['hip_sha256'] = digest(hip.read_bytes())
        runner.call([args.hipcc, '-O3', str(hip), '-o', str(root / 'candidate')], 'build-hip')
        report['binary_sha256'] = {name: digest((root / name).read_bytes()) for name in ['baseline', 'candidate']}

        devices = {}

        def measure(binary, backend, size, block):
            samples = []
            for trial in range(args.trials + 1):
                raw = runner.call([str(root / binary), str(size), str(block)], 'benchmark-' + backend)
                try:
                    value = json.loads(raw)
                except ValueError as exc:
                    raise PipelineError('benchmark must emit one JSON object') from exc
                elapsed = validate_measurement(value, backend, size, args.tolerance)
                if backend in devices and devices[backend] != value['device']:
                    raise PipelineError('device identity changed during execution')
                devices[backend] = value['device']
                value.update({'trial': trial, 'warmup': trial == 0, 'block': block})
                report['measurements'].append(value)
                if trial:
                    samples.append(elapsed)
            return statistics.median(samples)

        baseline = {size: measure('baseline', 'cuda', size, 256) for size in args.sizes}
        for block in args.blocks:
            measured = {size: measure('candidate', 'hip', size, block) for size in args.sizes}
            ratios = {size: measured[size] / baseline[size] for size in args.sizes}
            report['candidates'].append({'block': block, 'median_ms': measured,
                                         'worst_slowdown': max(ratios.values())})
        best = min(report['candidates'], key=lambda c: c['worst_slowdown'])
        report['hardware_validated'] = True
        report['selected'] = best
        report['status'] = 'passed' if best['worst_slowdown'] <= args.max_slowdown else 'rejected'
        for name, expected in report['binary_sha256'].items():
            if digest((root / name).read_bytes()) != expected:
                raise PipelineError('binary changed during execution')
        # Verify source receipts still describe the compiled input.
        if digest(frozen.read_bytes()) != report['source_sha256'] or digest(hip.read_bytes()) != report['hip_sha256']:
            raise PipelineError('source changed during execution')
    except (PipelineError, OSError) as exc:
        report['status'] = 'blocked'
        report['hardware_validated'] = False
        report['error'] = str(exc)
    finally:
        (root / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--allow-execute', action='store_true')
    parser.add_argument('--nvcc', default='nvcc')
    parser.add_argument('--hipcc', default='hipcc')
    parser.add_argument('--hipify', default='hipify-perl')
    parser.add_argument('--ruflo', help='Optional installed Ruflo executable for CUDA inventory')
    parser.add_argument('--budget', type=int, default=600)
    parser.add_argument('--timeout', type=int, default=120)
    parser.add_argument('--trials', type=int, default=5)
    parser.add_argument('--sizes', type=int, nargs='+', default=[1, 257, 65537, 1048576])
    parser.add_argument('--blocks', type=int, nargs='+', default=[128, 256, 512])
    parser.add_argument('--tolerance', type=float, default=1e-5)
    parser.add_argument('--max-slowdown', type=float, default=1.25)
    args = parser.parse_args()
    if not (1 <= args.budget <= 3600 and 1 <= args.timeout <= args.budget and 3 <= args.trials <= 30):
        parser.error('invalid runtime budget or trial count')
    if not (1 <= len(args.sizes) <= 16 and all(1 <= n <= 16777216 for n in args.sizes)):
        parser.error('invalid workload sizes')
    if not (1 <= len(args.blocks) <= 8 and all(n in [32, 64, 128, 256, 512, 1024] for n in args.blocks)):
        parser.error('invalid block candidates')
    if not math.isfinite(args.tolerance) or args.tolerance < 0 or not math.isfinite(args.max_slowdown) or args.max_slowdown <= 0:
        parser.error('invalid correctness or performance threshold')
    try:
        report = run(args)
    except OSError as exc:
        parser.exit(2, str(exc) + '\n')
    print(json.dumps({'status': report['status'], 'report': str(Path(args.output).resolve() / 'report.json')}))
    return 0 if report['status'] == 'passed' else 2


if __name__ == '__main__':
    raise SystemExit(main())
