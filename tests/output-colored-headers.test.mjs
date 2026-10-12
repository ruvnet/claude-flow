import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../v3/@claude-flow/cli-core/src/output.ts';
const visible = text => text.replace(/\x1b\[[0-9;]*m/g, '');
test('colored table headers use their visible width', () => {
 const f = new OutputFormatter({ color: true });
 const plain = f.table({ columns: [{ key: 'v', header: 'Header' }], data: [{ v: 'value' }] });
 const colored = f.table({ columns: [{ key: 'v', header: f.color('Header', 'red') }], data: [{ v: 'value' }] });
 assert.equal(visible(colored), visible(plain));
});
test('colored box titles align with every border and content row', () => {
 const f = new OutputFormatter({ color: true }); const plain = f.box('body', 'Title'); const colored = f.box('body', f.color('Title', 'red')); assert.equal(visible(colored), visible(plain));
});
