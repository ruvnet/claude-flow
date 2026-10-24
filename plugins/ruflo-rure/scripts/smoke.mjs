import { readFileSync, existsSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const checks = [];
const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };

const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
check('manifest name', manifest.name === 'ruflo-rure');
check('manifest semver', /^\d+\.\d+\.\d+$/.test(manifest.version));
check('manifest description states experimental/Phase 1 scope', /experimental/i.test(manifest.description) && /Phase 1/i.test(manifest.description));
check('no component arrays', !manifest.skills && !manifest.commands && !manifest.agents);

for (const dir of ['skills', 'commands', 'agents', 'docs/adrs']) {
  check(`${dir} exists`, existsSync(new URL(dir, root)));
}
check('ADR-0001 exists', existsSync(new URL('docs/adrs/0001-scope-and-dual-use-policy.md', root)));
check('ADR-0002 exists', existsSync(new URL('docs/adrs/0002-phase1-architecture.md', root)));
check('ADR-0005 exists', existsSync(new URL('docs/adrs/0005-phase4-evm-bytecode.md', root)));
check('ADR-0006 exists', existsSync(new URL('docs/adrs/0006-phase5-cuda-fatbin-static-analysis.md', root)));
check('ADR-0004 exists', existsSync(new URL('docs/adrs/0004-phase3-dotnet-metadata.md', root)));
check('ADR-0003 exists', existsSync(new URL('docs/adrs/0003-phase2-native-binary-static-analysis.md', root)));

const adr1 = read('docs/adrs/0001-scope-and-dual-use-policy.md');
check('ADR-0001 states parse-never-execute', /parses, (it )?never executes/i.test(adr1));
check('ADR-0001 states dual-use/DRM refusal', /DRM/i.test(adr1));

// ---------------------------------------------------------------------------
// The actual tool implementations live in the shared CLI package (same
// pattern as plugins/ruflo-browser), not inside this plugin directory.
// ---------------------------------------------------------------------------
const cliSrc = new URL('../../v3/@claude-flow/cli/src/', root);
const rureDir = new URL('rure/', cliSrc);
const toolsFile = 'mcp-tools/rure-tools.ts';

check('rure source directory exists in the CLI package', existsSync(rureDir));
check('rure-tools.ts exists in the CLI package', existsSync(new URL(toolsFile, cliSrc)));

const rureFiles = existsSync(rureDir)
  ? readdirSync(rureDir).filter((f) => f.endsWith('.ts')).map((f) => `rure/${f}`)
  : [];
const toolsSrc = existsSync(new URL(toolsFile, cliSrc)) ? readFileSync(new URL(toolsFile, cliSrc), 'utf8') : '';
const allSrc = [toolsSrc, ...rureFiles.map((f) => readFileSync(new URL(f, cliSrc), 'utf8'))];

// ADR-0001/0002: parses, never executes. Strip comments first so a doc
// comment *describing* this property (which necessarily names the
// forbidden tokens) can't trip its own check.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const FORBIDDEN = /\beval\(|new\s+Function\(|require\(\s*[a-zA-Z_$]|child_process|\bvm\./;
const toolFileNames = ['mcp-tools/rure-tools.ts', ...rureFiles];
for (let i = 0; i < allSrc.length; i++) {
  check(`${toolFileNames[i]}: no eval/vm/child_process/dynamic require`, !FORBIDDEN.test(stripComments(allSrc[i])));
}
check('at least the 3 Phase 1 rure source modules exist', rureFiles.length >= 3);

// AIDefence gate must actually be wired into the tool handlers, not just defined.
check('aidefence-gate module exists', rureFiles.includes('rure/aidefence-gate.ts'));
check('rure-tools.ts imports gateWithAIDefence', /gateWithAIDefence/.test(toolsSrc));

// Resource caps must be referenced by the tool layer (not just declared and unused).
check('rure-tools.ts references DEFAULT_ASAR_LIMITS', /DEFAULT_ASAR_LIMITS/.test(toolsSrc));
check('rure-tools.ts references MAX_BINARY_BYTES', /MAX_BINARY_BYTES/.test(toolsSrc));

// Tool names referenced by the skill/command/agent docs must exist on the tool list.
const toolNames = new Set([...toolsSrc.matchAll(/name:\s*'(rure_[a-z_]+)'/g)].map((m) => m[1]));
check('exactly eight tools (three Phase 1, one each Phase 2, 3, 4 and 5, and the CUDA launch plan)', toolNames.size === 8);
for (const expected of ['rure_extract_asar', 'rure_analyze_js_app', 'rure_find_feature', 'rure_analyze_binary', 'rure_analyze_dotnet', 'rure_analyze_evm', 'rure_analyze_cuda', 'rure_cuda_launch_plan']) {
  check(`tool ${expected} is registered`, toolNames.has(expected));
}

const skillText = existsSync(new URL('skills/analyze-app/SKILL.md', root)) ? read('skills/analyze-app/SKILL.md') : '';
for (const t of skillText.matchAll(/`(rure_[a-z_]+)`/g)) {
  check(`SKILL.md references real tool ${t[1]}`, toolNames.has(t[1]));
}
check('SKILL.md states authorization/DRM policy', /DRM/i.test(skillText));

check('changelog top entry matches manifest version', read('CHANGELOG.md').includes(`## ${manifest.version} —`));
check('benchmark script exists', existsSync(new URL('scripts/benchmark.ts', root)));

console.log(`smoke ok: ${checks.length} checks`);
