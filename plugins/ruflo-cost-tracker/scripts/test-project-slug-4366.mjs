#!/usr/bin/env node
/**
 * #4366: Claude Code slugifies every non-alphanumeric character in a project
 * path, not just `/`, `\` and `:`. A project under `my_project.v2` must map to
 * `my-project-v2`, or the Stop hook looks in a directory that never exists.
 */
import assert from 'node:assert/strict';
import { encodeProjectPath } from './_encode-project-path.mjs';

const cases = [
  ['/home/user/proj', '-home-user-proj'],
  ['D:\\project\\Subcloudy', 'D--project-Subcloudy'],
  ['C:\\Users\\john_doe\\my.project', 'C--Users-john-doe-my-project'],
  ['C:\\Users\\john doe\\my_project.v2', 'C--Users-john-doe-my-project-v2'],
  ['/home/user/a_b.c', '-home-user-a-b-c'],
];

for (const [input, expected] of cases) {
  assert.equal(encodeProjectPath(input), expected, `${input} -> ${expected}`);
}
console.log(`ok: encodeProjectPath matches Claude Code for ${cases.length} path shapes`);
