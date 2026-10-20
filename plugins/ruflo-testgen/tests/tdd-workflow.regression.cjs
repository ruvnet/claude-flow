const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../skills/tdd-workflow/SKILL.md'), 'utf8');
// Execute the documented hook example against observed outcomes, with no model/tool call.
const example = source.match(/```javascript\n([\s\S]*?)```/)?.[1]
  ?? source.match(/After completing: `([^`]+)`/)?.[1];
assert.ok(example, 'skill must provide a post-task example');
const cases = [
  ['green target and regression', {}, true],
  ['target still red', { targetExitCode: 1, failingTestNames: ['target rejects invalid input'] }, false],
  ['regression broken', { regressionExitCode: 1, failingTestNames: ['existing auth test'] }, false],
  ['abandoned', { completed: false }, false],
  ['interrupted runner', { targetExitCode: null }, false],
  ['target not run', { targetTestsRan: false }, false],
  ['regression not run', { regressionTestsRan: false }, false],
];
for (const [name, changes, expected] of cases) test(`#4085 ${name} records observed outcome`, () => {
  const observation = { completed: true, targetTestsRan: true, regressionTestsRan: true,
    targetExitCode: 0, regressionExitCode: 0, failingTestNames: [],
    targetCommand: 'npm test -- target', regressionCommand: 'npm test',
    failureReason: 'task incomplete or validation failed', ...changes };
  let receipt;
  vm.runInNewContext(example.replaceAll('mcp__plugin_ruflo-core_ruflo__hooks_post-task', 'mcp__plugin_ruflo_core_ruflo__hooks_post_task'), { ...observation, mcp__plugin_ruflo_core_ruflo__hooks_post_task: r => { receipt = r; } });
  assert.ok(receipt); assert.equal(receipt.success, expected);
  for (const failing of observation.failingTestNames) assert.ok(receipt.task.includes(failing));
});
