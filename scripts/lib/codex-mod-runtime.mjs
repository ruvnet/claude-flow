// Shared command-hook transport. Bundled into each plugin; no dependency outside its root.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_INPUT = 8 * 1024 * 1024;
function directory(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe status directory');
  }
  return absolute;
}
function snapshot(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return undefined; }
}
function write(file, bytes) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe status file');
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function updateStatus(plugin, event, change) {
  const data = directory(process.env.PLUGIN_DATA ?? path.join(os.homedir(), '.cache', 'ruflo-codex', plugin.name));
  const sessions = directory(path.join(data, 'sessions'));
  const file = path.join(sessions, `${hash(`${event.cwd}\0${event.session_id}`)}.json`);
  const lock = `${file}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
  }
  if (!acquired) throw new Error('Status writer busy'); // Never reap another writer's lock.
  try {
    const old = snapshot(file);
    const stats = old?.version === 1 && old.host === 'codex' && old.sessionId === event.session_id && plain(old.stats)
      ? old.stats : plugin.newStats();
    change(stats);
    const now = Date.now();
    const body = { version: 1, host: 'codex', sessionId: event.session_id, stats, updatedMs: now };
    write(file, `${JSON.stringify(body)}\n`);
    // Same version-1 courtesy view as the Claude mod; last writer wins across sessions/hosts.
    // Session-specific counters above are independent. Failure of the courtesy view cannot allow a denied write.
    try {
      const courtesy = path.join(directory(path.join(event.cwd, path.dirname(plugin.statusPath))), path.basename(plugin.statusPath));
      const view = JSON.parse(plugin.statusText(stats, now));
      write(courtesy, `${JSON.stringify({ ...view, host: 'codex', sessionId: event.session_id }, null, 2)}\n`);
    } catch { /* courtesy status is not guard authority */ }
    return stats;
  } finally { fs.rmdirSync(lock); }
}
function validEvent(event) {
  return plain(event) && typeof event.cwd === 'string' && path.isAbsolute(event.cwd)
    && typeof event.session_id === 'string' && event.session_id.length > 0 && event.session_id.length <= 512;
}
export async function runCodexHook(plugin) {
  const mode = process.argv[2];
  if (mode === '--command') {
    const cwd = process.cwd();
    const view = snapshot(path.join(cwd, plugin.statusPath));
    const text = await plugin.answer(process.argv.slice(3).join(' '), {
      opts: { guard: true }, guard: true, stats: view?.host === 'codex' ? view : plugin.newStats(), tools: async () => [],
      list: async (relative) => fs.readdirSync(path.join(cwd, relative), { withFileTypes: true })
        .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file' })),
    });
    process.stdout.write(`${text}\n`); return;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT) throw new Error('Hook input exceeds bound');
    chunks.push(chunk);
  }
  const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!validEvent(event) || event.hook_event_name !== mode) throw new Error('Invalid hook envelope');
  if (mode === 'SessionStart') {
    try { updateStatus(plugin, event, (stats) => { if ('startedMs' in stats && !stats.startedMs) stats.startedMs = Date.now(); }); }
    catch { process.stderr.write(`${plugin.name}: courtesy status unavailable\n`); }
    return; // No extra instructions or model turn.
  }
  if (mode !== 'PreToolUse' || typeof event.tool_name !== 'string' || !Object.hasOwn(event, 'tool_input')) throw new Error('Invalid native tool event');
  // Native freeform tools carry arbitrary JSON (including strings), not just objects.
  // A malformed memory writer cannot bypass scope checks by hiding namespace/key fields.
  const shortName = event.tool_name.startsWith('mcp__') ? event.tool_name.slice(event.tool_name.lastIndexOf('__') + 2) : event.tool_name;
  if (plugin.writers.includes(shortName) && !plain(event.tool_input)) throw new Error('Invalid guarded writer input');
  const reason = plugin.verdict(event.tool_name, event.tool_input);
  try { updateStatus(plugin, event, (stats) => plugin.count(stats, event.tool_name, event.tool_input, reason)); }
  catch { process.stderr.write(`${plugin.name}: courtesy status unavailable\n`); }
  if (reason !== undefined) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
  } })}\n`);
  // A permitted call emits nothing. Never emit unsupported continue/stopReason fields for PreToolUse.
}
export function hookFailure(plugin) {
  process.stderr.write(`${plugin}: native hook input or adapter failed\n`);
  process.exitCode = 2; // Native PreToolUse blocks before execution; no secret or raw input in diagnostics.
}
