import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const record = (type: string, payload: unknown) => ({ type, timestamp: '2026-10-09T00:00:00Z', payload });
export const meta = (id = 'helper', parent: string | null = 'root') => record('session_meta', {
  id, agent_path: `/root/${id}`, agent_nickname: `Agent ${id}`,
  source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli',
});
export const own = (id = 'helper') => record('event_msg', { type: 'thread_settings_applied', thread_id: id });
export const message = (text: string, role = 'assistant', phase: string | null = 'commentary') =>
  record('response_item', { type: 'message', role, phase, content: [{ type: 'output_text', text }] });
export const call = (id = 'call', command = 'npm test') => record('response_item', {
  type: 'function_call', call_id: id, name: 'exec_command', arguments: JSON.stringify({ cmd: command }),
});
export const result = (id = 'call', output: unknown = { exit_code: 0, output: 'Tests passed' }) =>
  record('response_item', { type: 'function_call_output', call_id: id, output });
export const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
export async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ruflo-activity-')));
  const parent = path.join(directory, 'parent.jsonl');
  const helper = path.join(directory, 'helper.jsonl');
  await writeFile(parent, jsonl([meta('root', null)]));
  await writeFile(helper, jsonl([meta(), own(), message('Check the parser fixtures.', 'user'), call(), result(),
    record('event_msg', { type: 'task_complete' })]));
  const nested = path.join(directory, 'next-day');
  await mkdir(nested);
  return { directory, parent, helper, nested };
}
