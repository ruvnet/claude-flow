const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const command = fs.readFileSync(`${root}/commands/ruflo-sparc.md`,'utf8');
const agent = fs.readFileSync(`${root}/agents/sparc-orchestrator.md`,'utf8');
test('#4086 status enumerates all keys and retrieves exact current values', () => {
  const status = command.split('### `')[2];
  assert.match(status, /memory_list/); assert.match(status, /offset/); assert.match(status, /total/);
  assert.match(status, /memory_retrieve/); assert.match(status, /current-phase-/);
  assert.doesNotMatch(status, /memory_search/);
  assert.match(agent, /memory_retrieve.*current-phase-/);
});
test('#4087 every explicit phase agent resolves to a shipped plugin agent', () => {
  const names = [...agent.matchAll(/\*\*Spawned agent\*\*: ([^\n]+)/g)].flatMap(m => [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]));
  assert.deepEqual(names, ['ruflo-core:researcher', 'ruflo-goals:goal-planner', 'ruflo-swarm:architect', 'ruflo-core:coder', 'ruflo-testgen:tester', 'ruflo-core:reviewer']);
  assert.match(agent, /available-agent registry/);
  assert.match(agent, /missing plugin/i);
  for (const name of names) {
    assert.match(name, /^ruflo-[a-z-]+:[a-z-]+$/);
    const [plugin, local] = name.split(':');
    const source = fs.readFileSync(path.join(root, '..', plugin, 'agents', `${local}.md`),'utf8');
    assert.match(source, new RegExp(`^name: ${local}$`, 'm'));
  }
});
test('#4088 SPARC command references resolve to the shipped command filename', () => {
  const markdown = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? markdown(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []);
  const files = [`${root}/README.md`, ...markdown(`${root}/commands`), ...markdown(`${root}/skills`)];
  for (const file of files) {
    const text = fs.readFileSync(file,'utf8');
    assert.doesNotMatch(text, /\/sparc(?:-(?:spec|implement|refine))?(?=[\s`<])/, file);
    for (const [, name] of text.matchAll(/\/ruflo-sparc:([a-z-]+)/g)) {
      const target = name === 'ruflo-sparc' ? `${root}/commands/${name}.md` : `${root}/skills/${name}/SKILL.md`;
      assert.match(fs.readFileSync(target, 'utf8'), new RegExp(`^name: ${name}$`, 'm'));
    }
  }
  assert.match(command, /\/ruflo-sparc:ruflo-sparc status/);
});
const section = name => command.split(`### \`/ruflo-sparc:ruflo-sparc ${name}`)[1].split('\n### ')[0];
test('#4086 initialize active state and timestamp every phase/gate state write', () => {
  assert.match(section('init'), /"status": "active"/);
  assert.match(section('init'), /"updatedAt": "<ISO timestamp>"/);
  assert.match(section('phase'), /updatedAt.*ISO/);
  for (const skill of ['sparc-spec', 'sparc-implement']) {
    const text = fs.readFileSync(`${root}/skills/${skill}/SKILL.md`, 'utf8');
    assert.match(text, /updatedAt.*ISO/);
    assert.match(text, /preserv\w* (?:all )?(?:other |existing )?state/i);
  }
});
test('#4086 active status filters explicit completion and orders legacy timestamps', () => {
  const status = section('status');
  assert.match(status, /Exclude.*status === "complete"/);
  assert.match(status, /Do not infer completion from phase 5/);
  assert.match(status, /Sort.*newest.*updatedAt/);
  assert.match(status, /metadata.*updatedAt.*storedAt/);
  assert.match(status, /unknown timestamps last/);
});
test('#4086 advance closes phase five only after its gate and refuses completed records', () => {
  const advance = section('advance');
  assert.match(advance, /status === "complete".*refuse/);
  assert.match(advance, /Phases 1–4.*increment/);
  assert.match(advance, /Phase 5.*final gate passes/);
  assert.match(advance, /\.\.\.state, phase: 5, phaseName: "Completion", status: "complete", completedAt: now, updatedAt: now/);
  assert.match(advance, /never.*6/);
  assert.match(advance, /If gate fails:[\s\S]*updatedAt[\s\S]*Do not.*complete/);
  assert.doesNotMatch(advance, /advancing past Phase 5/);
});
test('#4086 refine closes exact state once only after final gate evidence passes', () => {
  const refine = fs.readFileSync(`${root}/skills/sparc-refine/SKILL.md`, 'utf8');
  assert.match(refine, /final gate evidence.*passes/);
  assert.match(refine, /missing, failed, interrupted, or unrun/);
  assert.match(refine, /Do not.*complete.*state/);
  assert.match(refine, /status === "complete".*do not write again/);
  assert.match(refine, /memory_store.*namespace `sparc-state`.*exact key `current-phase-\{feature-slug\}`/);
  assert.match(refine, /\.\.\.state, phase: 5, phaseName: "Completion", status: "complete", completedAt: now, updatedAt: now/);
  assert.match(refine, /never.*6/);
});
