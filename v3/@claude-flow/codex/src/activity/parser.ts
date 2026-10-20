import { object, type ActivityEvent, type ActivitySnapshot, type RecordObject } from './types.js';
import { publicText, sanitize } from './sanitize.js';

const MAX_EVENTS = 80;
const CALL_ID = /^[\w.:/-]{1,300}$/;

/** An allowlist parser. Helper logs may begin with a complete copy of parent history. */
export class ActivityParser {
  readonly snapshot: ActivitySnapshot = {
    available: false, status: 'unknown', assignment: '', events: [], updatedAt: '',
    bytesRead: 0, fileSize: 0, partial: false, limited: false, attributed: false, error: '',
  };
  private first = true;
  private verified = false;
  private own = false;
  private calls = new Map<string, ActivityEvent>();

  constructor(private readonly identity: string, private readonly agentPath: string) {}

  invalidate(): void {
    this.own = false;
    this.calls.clear();
    this.snapshot.limited = true;
    if (this.first) { this.first = false; this.snapshot.error = 'Invalid first session record.'; }
  }

  consume(value: unknown): void {
    const record = object(value);
    if (!Object.keys(object(record.payload)).length) { this.invalidate(); return; }
    const payload = object(record.payload);
    if (this.first) {
      this.first = false;
      if (record.type !== 'session_meta' || payload.id !== this.identity) {
        this.snapshot.error = 'Session identity does not match the selected agent.';
        return;
      }
      this.verified = true;
      this.snapshot.available = true;
      return; // A helper's first header never opens the attribution boundary.
    }
    if (!this.verified) return;
    if (record.type === 'session_meta') { this.own = false; this.calls.clear(); return; }
    if (payload.thread_id !== undefined) {
      this.own = payload.thread_id === this.identity;
      if (!this.own) this.calls.clear();
    }
    if (!this.own) return;
    this.snapshot.attributed = true;
    const time = sanitize(record.timestamp ?? '', 80);
    if (record.type === 'event_msg') this.event(payload, time);
    if (record.type === 'response_item') this.response(payload, time);
  }

  private append(event: ActivityEvent): void {
    this.snapshot.events.push(event);
    if (this.snapshot.events.length > MAX_EVENTS) {
      const removed = this.snapshot.events.shift();
      for (const [id, item] of this.calls) if (item === removed) this.calls.delete(id);
      this.snapshot.limited = true;
    }
    this.snapshot.updatedAt = event.time;
  }

  private message(text: string, label: string, time: string): void {
    if (!text) return;
    const preview = sanitize(text);
    if (label === 'Assignment') this.snapshot.assignment = preview;
    if (this.snapshot.events.at(-1)?.text === preview) return;
    this.append({ kind: 'message', time, label, text: preview, output: '', status: '' });
  }

  private tool(id: unknown, name: unknown, input: unknown, time: string): void {
    if (typeof id !== 'string' || !CALL_ID.test(id) || this.calls.has(id)) return;
    const event: ActivityEvent = {
      kind: 'tool', time, label: sanitize(name ?? 'tool', 200), text: sanitize(input), output: '', status: 'running',
    };
    this.append(event);
    this.calls.set(id, event);
    this.snapshot.status = 'running';
  }

  private result(id: unknown, output: unknown, time: string, status?: string): void {
    const call = typeof id === 'string' ? this.calls.get(id) : undefined;
    if (!call) return;
    call.output = sanitize(output);
    call.status = status ?? resultStatus(output);
    this.snapshot.updatedAt = time;
  }

  private event(payload: RecordObject, time: string): void {
    const states: Record<string, string> = {
      task_started: 'running', task_complete: 'completed', task_failed: 'failed',
      turn_failed: 'failed', turn_aborted: 'interrupted', task_aborted: 'interrupted',
    };
    const state = typeof payload.type === 'string' ? states[payload.type] : undefined;
    if (state) { this.snapshot.status = state; this.snapshot.updatedAt = time; }
    if (payload.type === 'user_message') this.message(publicText(payload.message), 'Assignment', time);
    if (payload.type === 'agent_message') this.message(publicText(payload.message), 'Assistant', time);
    if (payload.type !== 'item_started' && payload.type !== 'item_completed') return;
    const item = object(payload.item);
    if (item.type === 'AgentMessage' && ['commentary', 'final', 'final_answer'].includes(String(item.phase))) {
      this.message(publicText(item.content), 'Assistant', time);
      this.snapshot.status = item.phase === 'commentary' ? 'running' : 'completed';
      return;
    }
    if (item.type !== 'CommandExecution' && item.type !== 'McpToolCall') return;
    this.tool(item.id, item.type === 'CommandExecution' ? 'command' : `${String(item.server)}.${String(item.tool)}`,
      item.command ?? item.arguments ?? '', time);
    if (payload.type === 'item_completed') {
      const status = ['failed', 'error', 'declined'].includes(String(item.status))
        || (item.exit_code !== undefined && item.exit_code !== null && item.exit_code !== 0) ? 'failed' : 'completed';
      this.result(item.id, item.aggregated_output ?? item.result ?? '', time, status);
    }
  }

  private response(payload: RecordObject, time: string): void {
    if (payload.type === 'message') {
      const phase = payload.channel ?? payload.phase;
      if (payload.role === 'user') this.message(publicText(payload.content), 'Assignment', time);
      else if (payload.role === 'assistant' && ['commentary', 'final', 'final_answer'].includes(String(phase))) {
        this.message(publicText(payload.content), 'Assistant', time);
        this.snapshot.status = phase === 'commentary' ? 'running' : 'completed';
      }
    } else if (payload.type === 'agent_message') {
      const incoming = !payload.recipient || payload.recipient === this.agentPath || payload.recipient === this.identity;
      this.message(publicText(payload.content), incoming ? 'Assignment' : 'Assistant', time);
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      this.tool(payload.call_id, payload.name, payload.arguments ?? payload.input ?? '', time);
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      this.result(payload.call_id, payload.output ?? '', time);
    }
  }
}

function resultStatus(output: unknown): string {
  if (typeof output === 'string') {
    try { return resultStatus(JSON.parse(output)); }
    catch {
      if (/(?:Script running with cell ID|Process running with session ID)/.test(output)) return 'running';
      const code = /(?:Process exited with code|exit_code["']?\s*:)\s*(-?\d+)/.exec(output);
      return code && Number(code[1]) !== 0 ? 'failed' : 'returned';
    }
  }
  const value = object(output);
  if (value.isError === true || (value.exit_code != null && value.exit_code !== 0)) return 'failed';
  if (value.session_id != null && value.exit_code == null) return 'running';
  return value.exit_code === 0 ? 'completed' : 'returned';
}
