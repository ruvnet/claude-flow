#!/usr/bin/env python3
"""Reproduce three CuLifter CPU probes from separately fetched pinned source."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, sys, time

HERE = pathlib.Path(__file__).resolve().parent
COMMIT = 'bc5a9f0fc7de929bb6965d7fed28a4dde6c1ef4b'
CASES = [
    ('A1_copy_1d_int', 'addr_A1_copy_1d_int', 'copy-independent.cpp'),
    ('A5_two_input', 'A5_two_input', 'float-sum-independent.cpp'),
    ('B28c_int_div_pow2', 'B28c_int_div_pow2', 'div-independent.cpp'),
]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', type=pathlib.Path, required=True)
    ap.add_argument('--output', type=pathlib.Path, required=True)
    args = ap.parse_args()
    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    staging = output / 'source'
    manifest = json.loads((HERE / 'upstream-files.json').read_text())
    if manifest['commit'] != COMMIT:
        raise ValueError('unrecognized source manifest')
    # Copy only reviewed, hash-verified files. Extra modules in a local checkout
    # cannot shadow imports in the isolated source snapshot.
    for item in manifest['files']:
        relative = pathlib.PurePosixPath(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('unsafe manifest path')
        path = source.joinpath(*relative.parts)
        if path.is_symlink() or digest(path) != item['sha256']:
            raise ValueError('source mismatch: ' + item['path'])
        target = staging.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    env = {'PATH': '/usr/bin:/bin', 'HOME': str(output), 'PYTHONHASHSEED': '0'}
    runs = []
    def run(label, argv, expected=0):
        start = time.perf_counter()
        result = subprocess.run(argv, cwd=output, env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=60, check=False)
        (output / (label + '.stdout')).write_text(result.stdout)
        (output / (label + '.stderr')).write_text(result.stderr)
        runs.append({'label': label, 'argv': argv, 'exitCode': result.returncode,
                     'elapsedSeconds': time.perf_counter() - start})
        if result.returncode != expected:
            raise RuntimeError(label + ' failed; see retained stdout/stderr')
        return result
    results = []
    try:
        for directory, symbol, driver in CASES:
            stem = output / directory
            fixture = staging / 'test' / 'addrtest' / directory
            run(directory + '-lift', [sys.executable, str(staging / 'main.py'),
                '-i', str(fixture / (directory + '_sm90.sass')),
                str(fixture / (directory + '_sm90.elf')), '-o', str(stem),
                '-name', symbol, '--lifter', 'x86'])
            run(directory + '-object', [sys.executable, str(HERE / 'emit-object.py'),
                str(stem) + '.ll', str(stem) + '.o'])
            run(directory + '-link', ['/usr/bin/g++', '-std=c++20', '-O2',
                str(HERE / driver), str(stem) + '.o', '-o', str(stem)])
            result = run(directory + '-execute', [str(stem)])
            observed = json.loads(result.stdout)
            if observed.get('status') != 'pass' or observed.get('cases') != 9 or observed.get('comparisons') != 1923:
                raise RuntimeError('unexpected correctness result')
            results.append({'kernel': symbol, **observed})
        original = (output / 'A1_copy_1d_int.ll').read_text()
        needle = '  store i32 %"ldg", i32* %"R2:R13_addr_ptr"'
        if original.count(needle) != 1:
            raise RuntimeError('mutation target changed')
        mutated = original.replace(needle, '  %"independent_mutation" = add i32 %"ldg", 1\n  store i32 %"independent_mutation", i32* %"R2:R13_addr_ptr"')
        (output / 'mutated.ll').write_text(mutated)
        run('mutation-object', [sys.executable, str(HERE / 'emit-object.py'), str(output / 'mutated.ll'), str(output / 'mutated.o')])
        run('mutation-link', ['/usr/bin/g++', '-std=c++20', '-O2', str(HERE / 'copy-independent.cpp'), str(output / 'mutated.o'), '-o', str(output / 'mutated')])
        mutation = run('mutation-execute', [str(output / 'mutated')], expected=1)
        failure = json.loads(mutation.stdout)
        if failure != {'status': 'fail', 'n': 1, 'index': 0, 'expected': 0, 'actual': 1}:
            raise RuntimeError('unexpected negative-control failure')
        from llvmlite import binding as llvm
        receipt = {'status': 'pass', 'sourceCommit': COMMIT, 'sourceFiles': len(manifest['files']),
            'kernels': 3, 'cases': 27, 'comparisons': 5769, 'results': results,
            'negativeControl': failure, 'llvm': list(llvm.llvm_version_info),
            'python': sys.version.split()[0], 'gpuExecuted': False,
            'claim': 'Narrow CPU reproduction only; no superiority or semantic proof.',
            'sourceManifestSha256': digest(HERE / 'upstream-files.json'),
            'artifactHashes': {p.name: digest(p) for p in output.iterdir() if p.is_file()},
            'runs': runs}
        (output / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({'status': 'pass', 'kernels': 3, 'cases': 27, 'comparisons': 5769,
                          'negativeControlRejected': True, 'receipt': str(output / 'result.json')}))
    finally:
        (output / 'commands.json').write_text(json.dumps(runs, indent=2) + '\n')

if __name__ == '__main__':
    main()
