"""Bounded public synthetic GPU checks, executed inside a disposable rental."""
import hashlib
import json
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

ROOT = Path('/tmp/rure-recovery')
ROOT.mkdir(exist_ok=True)
os_env = {'PATH': '/usr/local/cuda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8', 'LD_LIBRARY_PATH': '/usr/local/cuda/lib64:/usr/local/nvidia/lib:/usr/local/nvidia/lib64:/usr/lib/x86_64-linux-gnu'}
deadline = time.monotonic() + 210
commands = []

def run(args, expected=0, limit=90):
    remaining = min(limit, max(1, int(deadline - time.monotonic())))
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, env=os_env, timeout=remaining)
    commands.append({'argv': args, 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    if result.returncode != expected:
        raise RuntimeError('unexpected_exit:' + args[0])
    return result

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

result = {'status': 'incomplete', 'commands': commands, 'started_at': time.time(), 'actual_billed_usd': None}
try:
    bundle = ROOT / 'bundle'
    bundle.mkdir()
    with tarfile.open(ROOT / 'bundle.tar.gz', 'r:gz') as archive:
        files = archive.getmembers()
        assert len(files) <= 2000 and sum(m.size for m in files) <= 32 * 1024 * 1024
        for member in files:
            parts = Path(member.name).parts
            assert parts and not member.name.startswith('/') and '..' not in parts
            assert member.isdir() or member.isfile()
            if len(parts) == 1:
                continue
            target = bundle.joinpath(*parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
            else:
                with archive.extractfile(member) as source:
                    target.write_bytes(source.read())
    kernels = (bundle / 'kernels.txt').read_text().splitlines()
    assert 1 <= len(kernels) <= 100 and len(set(kernels)) == len(kernels)
    result['environment'] = run(['nvidia-smi', '--query-gpu=name,driver_version,memory.total,compute_cap', '--format=csv,noheader']).stdout
    result['nvcc'] = run(['nvcc', '--version']).stdout
    result['ptxas'] = run(['ptxas', '--version']).stdout
    result['cuobjdump'] = run(['cuobjdump', '--version']).stdout
    arch = 'sm_86'
    run(['nvcc', '-std=c++17', str(ROOT / 'ptx-recovery-gpu.cu'), '-lcuda', '-o', str(ROOT / 'validate')])
    exports = ROOT / 'baseline-inputs'
    exports.mkdir()
    artifacts = []
    for name in kernels:
        assert name.replace('_', '').isalnum() and len(name) <= 128
        directory = bundle / name
        run(['nvcc', '-std=c++17', '-ptx', '-arch=' + arch, str(directory / 'recovered.cu'), '-o', str(directory / 'recovered.ptx')])
        run(['ptxas', '-arch=' + arch, str(directory / 'original.ptx'), '-o', str(directory / 'original.cubin')])
        sass = run(['cuobjdump', '-sass', str(directory / 'original.cubin')]).stdout
        elf = run(['cuobjdump', '-elf', str(directory / 'original.cubin')]).stdout
        (exports / (name + '.sass')).write_text(sass)
        (exports / (name + '.elf')).write_text(elf)
        artifacts.append({'id': name, 'originalPtxSha256': sha(directory / 'original.ptx'), 'originalCubinSha256': sha(directory / 'original.cubin'), 'recoveredCudaSha256': sha(directory / 'recovered.cu'), 'compiledRecoveredPtxSha256': sha(directory / 'recovered.ptx'), 'sassSha256': sha(exports / (name + '.sass')), 'elfSha256': sha(exports / (name + '.elf'))})
    result['positive'] = json.loads(run([str(ROOT / 'validate'), str(bundle)]).stdout)
    mutation = ROOT / 'mutation'
    mutation.mkdir()
    shutil.copytree(bundle / 'add7_wrap32', mutation / 'add7_wrap32')
    (mutation / 'kernels.txt').write_text('add7_wrap32\n')
    assert (mutation / 'add7_wrap32' / 'mutated.cu').exists()
    run(['nvcc', '-std=c++17', '-ptx', '-arch=' + arch, str(mutation / 'add7_wrap32' / 'mutated.cu'), '-o', str(mutation / 'add7_wrap32' / 'recovered.ptx')])
    negative = run([str(ROOT / 'validate'), str(mutation)], expected=1)
    assert 'mismatch' in negative.stderr and 'variant=1' in negative.stderr
    result['negative_control'] = {'exitCode': 1, 'stderr': negative.stderr, 'detected': True}
    sanitizer = shutil.which('compute-sanitizer', path=os_env['PATH'])
    result['memcheck'] = {'status': 'unavailable', 'scope': 'counts 0, 1 and 33 of each kernel; timing omitted'}
    if sanitizer:
        checked_bundle = ROOT / 'memcheck'
        shutil.copytree(bundle, checked_bundle)
        for name in kernels:
            case_file = checked_bundle / name / 'case.txt'
            words = case_file.read_text().split()
            assert len(words) > 4
            case_file.write_text(' '.join(words[:4]) + '\n0 1 33\n')
        result['memcheck']['version'] = run([sanitizer, '--version']).stdout
        checked_result = run([sanitizer, '--tool', 'memcheck', '--error-exitcode', '3', str(ROOT / 'validate'), str(checked_bundle)], limit=60)
        result['memcheck'].update({'status': 'pass', 'exitCode': checked_result.returncode, 'stdout': checked_result.stdout, 'stderr': checked_result.stderr})
    result['artifacts'] = artifacts
    result['architecture'] = arch
    result['status'] = 'pass'
    (exports / 'manifest.json').write_text(json.dumps({'architecture': arch, 'artifacts': artifacts, 'nvcc': result['nvcc'], 'cuobjdump': result['cuobjdump']}, indent=2))
    with tarfile.open(ROOT / 'baseline-inputs.tar.gz', 'w:gz') as archive:
        archive.add(exports, arcname='baseline-inputs')
    result['baselineInputsSha256'] = sha(ROOT / 'baseline-inputs.tar.gz')
except Exception as error:
    result['status'] = 'failed'
    result['error_type'] = type(error).__name__
    result['error'] = str(error)
finally:
    result['elapsed_seconds'] = time.time() - result['started_at']
    # Large SASS/ELF dumps are in the artifact archive, not duplicated in receipts.
    for command in commands:
        if command['argv'][0] == 'cuobjdump' and command['argv'][1] in ['-sass', '-elf']:
            command['stdoutSha256'] = hashlib.sha256(command.pop('stdout').encode()).hexdigest()
    (ROOT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    positive = result.get('positive', {})
    summary = {k: positive.get(k) for k in ['status', 'claim', 'kernels', 'cases', 'elementComparisons', 'driver', 'gpu']}
    print(json.dumps({'status': result['status'], 'elapsed_seconds': result['elapsed_seconds'], 'kernels': len(result.get('artifacts', [])), 'positive': summary, 'negative_control': result.get('negative_control')}))
raise SystemExit(0 if result['status'] == 'pass' else 1)
