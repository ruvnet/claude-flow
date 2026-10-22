import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ActivityViewer } from '../src/activity/viewer.js';
import { ActivityReader } from '../src/activity/reader.js';
import { fixture, jsonl, meta } from './activity-fixtures.js';

let files: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { files = await fixture(); });
afterEach(async () => { vi.restoreAllMocks(); await rm(files.directory, { recursive: true, force: true }); });

describe('agent picker', () => {
  it('opens the selected helper and shows its assignment, command and result', async () => {
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh();
    expect(viewer.render()).toContain('AGENTS - choose one');
    viewer.key('return');
    await viewer.refresh();
    const output = viewer.render(100, 100);
    expect(output).toContain('Check the parser fixtures.');
    expect(output).toContain('npm test');
    expect(output).toContain('Tests passed');
    expect(output).toContain('completed (recorded)');
    viewer.key('b');
    expect(viewer.render()).toContain('AGENTS - choose one');
  });
  it('keeps selection when the list order changes and does not substitute a vanished agent', async () => {
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh();
    viewer.key('return');
    await writeFile(path.join(files.nested, 'aaa.jsonl'), jsonl([meta('aaa')]));
    await viewer.refresh();
    expect(viewer.selected).toBe('helper');
    await rm(files.helper);
    await viewer.refresh();
    expect(viewer.render()).toContain('no longer available');
    expect(viewer.selected).toBe('helper');
    viewer.key('b'); viewer.key('down');
    expect(viewer.selected).toBe('aaa');
  });
  it('rejects a changed parent identity and clears the visible helper activity', async () => {
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh(); viewer.key('return'); await viewer.refresh();
    await writeFile(files.parent, jsonl([meta('other', null)]));
    await viewer.refresh();
    expect(viewer.render()).toContain('unchanged identity');
    expect(viewer.render()).not.toContain('npm test');
  });
  it('clears the prior helper immediately, before the new helper is read', async () => {
    await writeFile(path.join(files.nested, 'zzz.jsonl'), jsonl([meta('zzz')]));
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh(); viewer.key('return'); await viewer.refresh();
    expect(viewer.render(100, 100)).toContain('npm test');
    viewer.key('b'); viewer.key('down'); viewer.key('return');
    expect(viewer.render(100, 100)).toContain('/root/zzz');
    expect(viewer.render(100, 100)).not.toContain('npm test');
  });
  it('does not publish a previous helper read that finishes after selection changes', async () => {
    await writeFile(path.join(files.nested, 'zzz.jsonl'), jsonl([meta('zzz')]));
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh(); viewer.key('return'); await viewer.refresh();
    const prior = viewer.activity!;
    let complete: (value: typeof prior) => void = () => {};
    let started: () => void = () => {};
    const reading = new Promise<void>(resolve => { started = resolve; });
    vi.spyOn(ActivityReader.prototype, 'read').mockImplementation(() => {
      started(); return new Promise(resolve => { complete = resolve; });
    });
    const refresh = viewer.refresh();
    await reading;
    viewer.key('b'); viewer.key('down'); viewer.key('return');
    complete(prior); await refresh;
    expect(viewer.activity).toBeNull();
    expect(viewer.render(100, 100)).not.toContain('npm test');
  });
  it.each([[25, 12], [40, 10], [80, 8]])('keeps the selected picker row visible at %ix%i', async (width, height) => {
    for (const id of ['aaa', 'bbb', 'ccc']) {
      const header = meta(id);
      header.payload.agent_path = `/root/${id}-${'long-name-'.repeat(10)}`;
      await writeFile(path.join(files.nested, `${id}.jsonl`), jsonl([header]));
    }
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh();
    viewer.selected = 'ccc';
    for (const partial of [false, true]) {
      viewer.list.partial = partial;
      const output = viewer.render(width, height);
      expect(output).toContain('> /root/ccc-');
      expect(output.split('\n').length).toBeLessThanOrEqual(height);
      expect(output.split('\n').every(line => line.length < width)).toBe(true);
    }
    viewer.key('up');
    expect(viewer.render(width, height)).toContain('> /root/bbb-');
  });
  it('supports narrow windows, scroll, follow-latest and top navigation', async () => {
    const viewer = new ActivityViewer(files.directory, files.parent);
    await viewer.refresh(); viewer.key('return'); await viewer.refresh();
    expect(viewer.render(25, 12).split('\n').every(line => line.length <= 24)).toBe(true);
    viewer.key('G'); viewer.render(25, 12);
    expect(viewer.offset).toBeGreaterThan(0);
    viewer.key('g'); viewer.render(25, 12);
    expect(viewer.offset).toBe(0);
  });
});
