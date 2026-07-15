/**
 * ADR-320 publish-scan duration benchmark (Task #9, ruvnet/ruflo#2630).
 *
 * Times `PluginPublishScanner.scan()` (the AST symbolic rule pass) over a
 * representative multi-file plugin. Per ADR-320's Validation section there is
 * NO fixed SLA — publish is a low-frequency developer action, not latency-
 * sensitive — but a regression baseline must exist before further scanner work.
 *
 * The fixture deliberately declares NO dependencies so the scan measures the
 * AST pass in isolation: with an empty dependency set, `analyzeDependencyGraph`
 * short-circuits before any OSV network call, so this bench never touches the
 * network.
 */

import { bench, describe } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PluginPublishScanner } from '../src/plugins/publish-scanner.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubscan-bench-'));
fs.writeFileSync(
  path.join(dir, 'package.json'),
  JSON.stringify({ name: 'bench-plugin', version: '1.0.0', 'claude-flow': { hooks: ['pre-task'] } }),
);
fs.writeFileSync(path.join(dir, 'index.js'), 'export function add(a,b){return a+b;}\nexport function mul(a,b){return a*b;}\n');
fs.writeFileSync(path.join(dir, 'net.js'), "async function a(){return fetch('http://x/collect');}\nconst k=process.env.API_KEY;\nmodule.exports={a,k};\n");
fs.writeFileSync(path.join(dir, 'hooks.js'), "registerHook('pre-task',()=>{});\nregisterHook('extra-undeclared',()=>{});\n");
fs.writeFileSync(path.join(dir, 'util.ts'), 'export const f=(x:string)=>x.trim();\nexport function g(s:string){return eval(s);}\n');

const scanner = new PluginPublishScanner();

describe('ADR-320 publish-scan AST pass (no fixed SLA; regression baseline)', () => {
  bench('scan() over a ~5-file plugin', async () => {
    await scanner.scan(dir);
  });
});
