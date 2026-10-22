import { listSessions, type SessionList } from './files.js';
import { ActivityReader } from './reader.js';
import { sanitize } from './sanitize.js';
import type { ActivitySnapshot } from './types.js';

export class ActivityViewer {
  list: SessionList = { root: null, helpers: [], partial: false, error: '' };
  selected: string | null = null;
  detail = false;
  offset = 0;
  follow = false;
  activity: ActivitySnapshot | null = null;
  private rootId: string | undefined;
  private reader: ActivityReader | null = null;
  private readerKey = '';

  constructor(private readonly directory: string, private readonly sessionFile: string) {}

  async refresh(): Promise<void> {
    this.list = await listSessions(this.directory, this.sessionFile, this.rootId);
    if (this.list.root) this.rootId = this.list.root.id;
    if (!this.selected) this.selected = this.list.helpers[0]?.id ?? null;
    const helper = this.list.helpers.find(item => item.id === this.selected);
    if (!this.detail || !helper || this.list.error) { this.activity = null; return; }
    const key = `${helper.file}\0${helper.id}`;
    if (key !== this.readerKey) {
      this.reader = new ActivityReader(this.directory, helper);
      this.readerKey = key;
    }
    const activity = await this.reader!.read();
    if (this.detail && this.selected === helper.id && this.readerKey === key) this.activity = activity;
  }

  key(name: string): void {
    const movement = name === 'down' || name === 'j' ? 1 : name === 'up' || name === 'k' ? -1 : 0;
    if (name === 'escape' || name === 'b') {
      this.detail = false; this.offset = 0; this.follow = false; this.activity = null;
    }
    else if (name === 'return' && this.list.helpers.some(item => item.id === this.selected)) {
      this.detail = true; this.offset = 0; this.activity = null;
    } else if (this.detail) {
      if (name === 'G') this.follow = true;
      else if (name === 'g') { this.follow = false; this.offset = 0; }
      else if (movement || name === 'space') {
        this.follow = false;
        this.offset = Math.max(0, this.offset + (name === 'space' ? 10 : movement));
      }
    } else if (movement) {
      const current = this.list.helpers.findIndex(item => item.id === this.selected);
      const index = Math.max(0, Math.min(this.list.helpers.length - 1, current + movement));
      this.selected = this.list.helpers[index]?.id ?? null;
      this.activity = null;
    }
  }

  render(width = 100, height = 30, now = Date.now()): string {
    const columns = Math.max(10, Math.min(240, width - 1));
    const lines: string[] = ['CODEX AGENT ACTIVITY', 'Read-only | state comes from local records', ''];
    if (this.list.error) lines.push(this.list.error);
    else {
      lines.push(`Session: ${sanitize(this.list.root?.id ?? '', 100)}`);
      if (this.list.partial) lines.push('Discovery incomplete: scan limit, duplicate identity, or unreadable entries.');
      if (!this.detail) {
        lines.push('', 'AGENTS - choose one and press Enter');
        if (!this.list.helpers.length) lines.push('No attributable helpers found in the selected directory.');
        const selected = this.list.helpers.findIndex(item => item.id === this.selected);
        const count = Math.max(1, height - 10);
        const start = Math.max(0, selected - count + 1);
        for (const helper of this.list.helpers.slice(start, start + count)) {
          const label = `${helper.id === this.selected ? '>' : ' '} ${helper.path}${helper.name ? ` (${helper.name})` : ''}`;
          lines.push(wrap(label, columns).length > 1 ? `${wrap(label, columns - 3)[0]}...` : label);
        }
        if (this.list.helpers.length > count) lines.push(`Showing ${start + 1}-${Math.min(start + count, this.list.helpers.length)} of ${this.list.helpers.length}`);
      } else this.detailLines(lines, now);
    }
    const wrapped = lines.flatMap(line => wrap(line, columns));
    const room = Math.max(1, height - 2);
    const maximum = Math.max(0, wrapped.length - room);
    // Wrapped headings can fill a short terminal too. Keep the selected row visible.
    const pickerOffset = Math.max(0, wrapped.findIndex(line => line.startsWith('> ')) - room + 1);
    this.offset = this.detail ? (this.follow ? maximum : Math.min(this.offset, maximum)) : pickerOffset;
    const footer = this.detail ? 'b back | j/k scroll | Space page | g top | G latest | q quit'
      : 'j/k or arrows select | Enter details | q quit';
    return [...wrapped.slice(this.offset, this.offset + room), '', ...wrap(footer, Math.max(10, width - 1)).slice(0, 1)].join('\n');
  }

  private detailLines(lines: string[], now: number): void {
    const helper = this.list.helpers.find(item => item.id === this.selected);
    if (!helper) { lines.push('', 'Selected agent is no longer available. Press b to return.'); return; }
    lines.push('', helper.path, helper.name, `Agent: ${sanitize(helper.id, 100)}`);
    const activity = this.activity;
    if (!activity) { lines.push('Reading agent log...'); return; }
    if (activity.error) { lines.push(activity.error); return; }
    lines.push(`State: ${activity.status} (recorded)`);
    const timestamp = Date.parse(activity.updatedAt);
    lines.push(`Last recorded activity: ${Number.isFinite(timestamp) ? `${Math.max(0, Math.floor((now - timestamp) / 1000))}s ago` : 'unavailable'}`);
    if (activity.partial) lines.push(`Reading: ${activity.bytesRead}/${activity.fileSize} bytes; incomplete records may follow.`);
    if (!activity.attributed) lines.push('Waiting for a record attributed to this helper; inherited history is hidden.');
    if (activity.limited) lines.push('History is limited: old, oversized, or malformed records were omitted.');
    lines.push('', 'ASSIGNMENT', activity.assignment || 'Not available in attributable records.', '', 'ACTIVITY');
    for (const event of activity.events) {
      lines.push(`${event.time} ${event.label}${event.status ? ` [${event.status}]` : ''}`);
      lines.push(event.kind === 'tool' ? `Command / input: ${event.text}` : event.text);
      if (event.output) lines.push(`Result: ${event.output}`);
      lines.push('');
    }
  }
}

/** Keep wide characters inside the terminal; unknown emoji sequences may use extra space. */
function wrap(text: string, width: number): string[] {
  const result: string[] = [];
  for (const line of sanitize(text, 16000).replace(/\t/g, '    ').split('\n')) {
    let row = '';
    let columns = 0;
    for (const character of line) {
      const code = character.codePointAt(0)!;
      const size = /\p{Mark}/u.test(character) ? 0 :
        code >= 0x1100 && (code <= 0x115f || code >= 0x2329 && code <= 0xa4cf
          || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff
          || code >= 0xfe10 && code <= 0xfe6f || code >= 0xff01 && code <= 0xff60
          || code >= 0x1f000) ? 2 : 1;
      if (columns + size > width) { result.push(row); row = ''; columns = 0; }
      row += character; columns += size;
    }
    result.push(row);
  }
  return result;
}
