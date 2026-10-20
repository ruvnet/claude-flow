import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findAdrs } from '../plugins/ruflo-adr/scripts/lib/parse-adrs.mjs';
test('directory cycles enumerate each real ADR once and scans remain independent',()=>{
 const root=mkdtempSync(join(tmpdir(),'adr-cycle-'));
 try{
  const adr=join(root,'docs','adr');mkdirSync(adr,{recursive:true});
  writeFileSync(join(adr,'001-example.md'),'# Example');symlinkSync(adr,join(adr,'loop'),'dir');
  assert.equal(findAdrs(root).length,1);assert.equal(findAdrs(root).length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
