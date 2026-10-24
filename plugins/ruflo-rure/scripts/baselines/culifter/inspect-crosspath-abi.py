#!/usr/bin/env python3
"""Inspect only the four designated development inputs before native execution."""
import dataclasses, hashlib, json, pathlib, sys
source=pathlib.Path(sys.argv[1]).resolve(strict=True)
inputs=pathlib.Path(sys.argv[2]).resolve(strict=True)
output=pathlib.Path(sys.argv[3]).resolve()
sys.path.insert(0,str(source))
from utils.elf import Elf
from parse.parser import SaSSParser
from transform.sr_substitute import _sr_map_for_isa
ids=['copy32','add7_wrap32','multiply_low64','wide_signed']
records={}; offsets={}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for name in ids:
    sass=inputs/(name+'.sass'); elf_file=inputs/(name+'.elf')
    elf=Elf(elf_file); parser=SaSSParser(sass.read_text(),elf)
    args=[dataclasses.asdict(a) for a in elf.kernel_args(name)]
    if parser.isa!='sm_86': raise ValueError(name+': expected native sm_86 input')
    if [a['ordinal'] for a in args]!=list(range(5)) or [a['size'] for a in args]!=[8,8,8,4,8]:
        raise ValueError(name+': unsupported scalar argument ABI')
    slots=[]
    for a in args:
        if a['offset']<0 or a['offset']+a['size']>4096: raise ValueError('out-of-range argument')
        slot=set(range(a['offset'],a['offset']+a['size']))
        if any(slot & other for other in slots): raise ValueError('overlapping arguments')
        slots.append(slot)
    sr=_sr_map_for_isa(parser.isa)
    if (sr['SR_NTID.X'],sr['SR_CTAID.X'],sr['SR_TID.X'])!=(0,32,44):
        raise ValueError('runtime special-register layout differs')
    if elf.frame_size.get(name,0) or elf.min_stack_size.get(name,0) or elf.static_shared_bytes(name):
        raise ValueError(name+': scalar adapter does not cover stack/shared allocation')
    records[name]={'isa':parser.isa,'parameters':args,'sassSha256':sha(sass),
                   'elfSha256':sha(elf_file),'frameSize':elf.frame_size.get(name,0),
                   'minStackSize':elf.min_stack_size.get(name,0),'sharedBytes':elf.static_shared_bytes(name)}
    offsets[name]=args
output.mkdir(parents=True,exist_ok=True)
(output/'parameter-offsets.json').write_text(json.dumps(offsets,indent=2)+'\n')
(output/'abi-inspection.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps({'status':'abi-accepted','kernels':len(records)}))
