#!/usr/bin/env python3
"""Read pinned CuLifter metadata; fail closed outside the frozen scalar scope."""
import argparse
import dataclasses
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'sass', 'elf', 'output']:
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--symbol', required=True)
    parser.add_argument('--architecture', required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.source.resolve(strict=True)))
    from utils.elf import Elf
    from parse.parser import SaSSParser
    from transform.sr_substitute import _sr_map_for_isa
    elf = Elf(args.elf)
    parser = SaSSParser(args.sass.read_text(), elf)
    abi = [dataclasses.asdict(x) for x in elf.kernel_args(args.symbol)]
    record = {'state': 'admitted', 'symbol': args.symbol, 'isa': parser.isa, 'parameters': abi,
              'frameSize': elf.frame_size.get(args.symbol, 0),
              'minStackSize': elf.min_stack_size.get(args.symbol, 0),
              'sharedBytes': elf.static_shared_bytes(args.symbol),
              'globalBytes': elf.nv_global_size + len(elf.nv_global_init)}
    if parser.isa != args.architecture:
        raise ValueError('artifact architecture mismatch')
    if [x['ordinal'] for x in abi] != list(range(5)) or [x['size'] for x in abi] != [8, 8, 8, 4, 8]:
        record.update(state='unsupported_scope', reason='five-argument ABI differs')
    elif record['frameSize'] or record['minStackSize'] or record['sharedBytes'] or record['globalBytes']:
        record.update(state='unsupported_scope', reason='scalar CPU adapter excludes stack/shared/device globals')
    record['specialRegisters'] = _sr_map_for_isa(parser.isa)
    args.output.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))
    return 0 if record['state'] == 'admitted' else 2


if __name__ == '__main__':
    sys.exit(main())
