import sys,pathlib,json
from llvmlite import binding as llvm
llvm.initialize_native_target()
llvm.initialize_native_asmprinter()
source=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])
mod=llvm.parse_assembly(source.read_text()); mod.verify()
triple=llvm.get_default_triple(); mod.triple=triple
tm=llvm.Target.from_triple(triple).create_target_machine(opt=2,reloc='pic',codemodel='small')
out.write_bytes(tm.emit_object(mod))
print(json.dumps({'verified_ir':True,'llvm_version':llvm.llvm_version_info,'target':triple,'object_bytes':out.stat().st_size}))
