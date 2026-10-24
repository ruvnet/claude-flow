#!/usr/bin/env python3
"""Generate a scalar CPU oracle driver from bounded data, never kernel semantics."""
import argparse
import hashlib
import json
from pathlib import Path
import re

IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,127}\Z')
DECIMAL = re.compile(r'(?:0|[1-9][0-9]*)\Z')
WIDTHS = {'ptr': 8, 'u32': 4, 'u64': 8}
MAX_CASES = 32
MAX_VALUES = 8192
MAX_THREADS = 131072


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('invalid identifier')
    return value


def integer(value, bits):
    if not isinstance(value, str) or not DECIMAL.fullmatch(value):
        raise ValueError('integer values must be unsigned decimal strings')
    number = int(value)
    if number >= 1 << bits:
        raise ValueError('integer value exceeds declared width')
    return number


def generate(kernel, abi):
    name = identifier(kernel['id'])
    symbol = identifier(kernel['symbol'])
    types = kernel['parameterTypes']
    if not isinstance(types, list) or not 1 <= len(types) <= 16 or any(t not in WIDTHS for t in types):
        raise ValueError('unsupported parameter types')
    parameters = abi['parameters']
    if [p['ordinal'] for p in parameters] != list(range(len(types))):
        raise ValueError('parameter ordinal mismatch')
    if [p['size'] for p in parameters] != [WIDTHS[t] for t in types]:
        raise ValueError('parameter size mismatch')
    occupied = set()
    for p in parameters:
        offset = p['offset']
        if type(offset) is not int or not 0 <= offset <= 4096 - p['size']:
            raise ValueError('parameter offset out of range')
        slots = set(range(offset, offset + p['size']))
        if slots & occupied:
            raise ValueError('overlapping parameters')
        occupied |= slots
    sr = abi['specialRegisters']
    required = ['SR_NTID.X', 'SR_GRID_DIM.X', 'SR_CTAID.X', 'SR_TID.X', 'SR_LANEID',
                'SR_NTID.Y', 'SR_NTID.Z', 'SR_GRID_DIM.Y', 'SR_GRID_DIM.Z']
    if any(type(sr.get(key)) is not int or not 0 <= sr[key] <= 4092 for key in required):
        raise ValueError('missing or out-of-range special register')
    if any(set(range(sr[key], sr[key] + 4)) & occupied for key in required):
        raise ValueError('special register overlaps parameter')
    register_slots = set()
    for key in required:
        slots = set(range(sr[key], sr[key] + 4))
        if slots & register_slots:
            raise ValueError('overlapping special registers')
        register_slots |= slots
    cases = kernel['cases']
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise ValueError('invalid case count')
    lines = ['#include <stdint.h>', '#include <stdio.h>', '#include <string.h>',
             'extern "C" {',
             'alignas(8) thread_local uint8_t const_mem[5][4096] = {};',
             'alignas(16) thread_local uint8_t local_mem[32768] = {};',
             'alignas(16) uint8_t shared_mem[32768] = {};', f'void {symbol}();', '}',
             'template<class T> static void set(unsigned o,T v){memcpy(&const_mem[0][o],&v,sizeof(v));}',
             'int main(){uint64_t comparisons=0;']
    total = 0
    seen_cases = set()
    for case in cases:
        case_id = identifier(case['id'])
        if case_id in seen_cases:
            raise ValueError('duplicate case identifier')
        seen_cases.add(case_id)
        block, grid = case['blockDimX'], case['gridDimX']
        if type(block) is not int or type(grid) is not int or not 1 <= block <= 1024 or not 1 <= grid or grid * block > MAX_THREADS:
            raise ValueError('launch exceeds scalar CPU scope')
        buffers = case['buffers']
        if not isinstance(buffers, dict) or not 1 <= len(buffers) <= 16:
            raise ValueError('invalid buffers')
        lines.append('{ memset(const_mem,0,sizeof(const_mem)); memset(local_mem,0,sizeof(local_mem));')
        expected = []
        for buffer_name, buffer in buffers.items():
            identifier(buffer_name)
            bits = buffer['bits']
            if type(bits) is not int or bits not in (32, 64):
                raise ValueError('unsupported buffer width')
            values = buffer['values']
            if not isinstance(values, list) or not 1 <= len(values) <= MAX_VALUES:
                raise ValueError('invalid buffer length')
            literal = ','.join(str(integer(x, bits)) + 'ULL' for x in values)
            lines.append(f'alignas(256) uint{bits}_t b_{buffer_name}[]={{ {literal} }};')
            if 'expected' in buffer:
                if not isinstance(buffer['expected'], list) or len(buffer['expected']) != len(values):
                    raise ValueError('expected array length differs')
                literal = ','.join(str(integer(x, bits)) + 'ULL' for x in buffer['expected'])
                lines.append(f'const uint{bits}_t e_{buffer_name}[]={{ {literal} }};')
                expected.append((buffer_name, len(values)))
                total += len(values)
        if not expected:
            raise ValueError('case has no output oracle')
        arguments = case['arguments']
        if not isinstance(arguments, list) or len(arguments) != len(types):
            raise ValueError('argument count mismatch')
        for typ, arg, p in zip(types, arguments, parameters):
            if not isinstance(arg, dict) or len(arg) != 1:
                raise ValueError('invalid argument')
            if typ == 'ptr':
                if set(arg) != {'buffer'} or arg['buffer'] not in buffers:
                    raise ValueError('pointer does not name declared buffer')
                value = f'uint64_t(uintptr_t(b_{identifier(arg["buffer"])}))'
            else:
                if set(arg) != {typ}:
                    raise ValueError('scalar argument type mismatch')
                value = f'uint{typ[1:]}_t({integer(arg[typ], int(typ[1:]))}ULL)'
            lines.append(f'set({p["offset"]},{value});')
        lines += [f'set({sr["SR_NTID.X"]},uint32_t({block}));',
                  f'set({sr["SR_GRID_DIM.X"]},uint32_t({grid}));']
        for key in ['SR_NTID.Y', 'SR_NTID.Z', 'SR_GRID_DIM.Y', 'SR_GRID_DIM.Z']:
            if type(sr.get(key)) is not int or not 0 <= sr[key] <= 4092 or set(range(sr[key], sr[key] + 4)) & occupied:
                raise ValueError('invalid secondary launch-dimension mapping')
            lines.append(f'set({sr[key]},uint32_t(1));')
        lines += [
                  f'for(uint32_t block=0;block<{grid};++block){{',
                  f'set({sr["SR_CTAID.X"]},block);',
                  f'for(uint32_t thread=0;thread<{block};++thread){{',
                  f'set({sr["SR_TID.X"]},thread);set({sr["SR_LANEID"]},uint32_t(thread%32));',
                  f'{symbol}();', '}}']
        for buffer_name, count in expected:
            lines.append(f'for(unsigned i=0;i<{count};++i){{++comparisons;if(b_{buffer_name}[i]!=e_{buffer_name}[i]){{'
                         f'printf("FAIL {name} {case_id} {buffer_name} index=%u expected=%llu actual=%llu\\n",i,'
                         f'(unsigned long long)e_{buffer_name}[i],(unsigned long long)b_{buffer_name}[i]);return 1;}}}}')
        lines.append('}')
    format_string = '{"status":"pass","kernel":"' + name + '","cases":' + str(len(cases)) + ',"comparisons":%llu}\n'
    lines.append(f'printf({json.dumps(format_string)},(unsigned long long)comparisons);return 0;}}')
    return '\n'.join(lines) + '\n', {'kernel': name, 'cases': len(cases), 'comparisons': total}


def normalize_oracle(oracle, symbol):
    """Adapt the evaluator's frozen data-only five-argument fixture schema."""
    if [case['count'] for case in oracle['cases']] != [0, 1, 3, 17, 32, 67]:
        raise ValueError('frozen case counts differ')
    cases = []
    for case in oracle['cases']:
        n = case['count']
        if len(case['input']) != 2 * n + 8 or len(case['aux']) != 2 * n + 8 or len(case['expected']) != n + 8:
            raise ValueError('frozen buffer lengths differ')
        cases.append({'id': 'count_' + str(n), 'blockDimX': 8, 'gridDimX': (n + 7) // 8 + 1,
                      'buffers': {'input': {'bits': oracle['inputBits'], 'values': case['input']},
                                  'aux': {'bits': oracle['inputBits'], 'values': case['aux']},
                                  'output': {'bits': oracle['outputBits'], 'values': [case['sentinel']] * (n + 8),
                                             'expected': case['expected']}},
                      'arguments': [{'buffer': 'input'}, {'buffer': 'aux'}, {'buffer': 'output'},
                                    {'u32': str(n)}, {'u64': case['scalar']}]})
    return {'id': oracle['id'], 'symbol': symbol, 'parameterTypes': ['ptr', 'ptr', 'ptr', 'u32', 'u64'], 'cases': cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--oracle', required=True, type=Path)
    parser.add_argument('--abi', required=True, type=Path)
    parser.add_argument('--symbol', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    oracle = json.loads(args.oracle.read_text())
    source, expected = generate(normalize_oracle(oracle, args.symbol), json.loads(args.abi.read_text()))
    args.output.write_text(source)
    print(json.dumps({'expected': expected, 'driverSha256': hashlib.sha256(source.encode()).hexdigest()}))


if __name__ == '__main__':
    main()
