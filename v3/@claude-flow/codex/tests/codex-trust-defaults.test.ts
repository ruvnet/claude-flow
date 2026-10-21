import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexInitializer } from '../src/initializer.js';

let projectPath: string;
let originalPath: string | undefined;
let originalTrust: string | undefined;

const localConfig = () => join(projectPath, '.codex', 'config.toml');
const read = () => readFileSync(localConfig(), 'utf8');

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'codex-trust-'));
  originalPath = process.env.PATH;
  originalTrust = process.env.RUFLO_CODEX_TRUST;
  delete process.env.RUFLO_CODEX_TRUST;
  // Keep the test away from the user's Codex/plugin registrations.
  process.env.PATH = '';
});

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalTrust === undefined) delete process.env.RUFLO_CODEX_TRUST;
  else process.env.RUFLO_CODEX_TRUST = originalTrust;
  rmSync(projectPath, { recursive: true, force: true });
});

describe('generated .codex/config.toml trust level', () => {
  it('defaults to workspace-write, on-request approvals and cached web search', async () => {
    const result = await new CodexInitializer().initialize({ projectPath, template: 'minimal', dual: true });
    expect(result.success).toBe(true);
    const toml = read();
    expect(toml).toMatch(/^sandbox_mode = "workspace-write"$/m);
    expect(toml).toMatch(/^approval_policy = "on-request"$/m);
    expect(toml).toMatch(/^web_search = "cached"$/m);
    expect(toml).not.toContain('danger-full-access');
    expect(toml).not.toMatch(/approval_policy = "never"/);
    expect(toml).not.toMatch(/web_search = "live"/);
  });

  it('is also safe for a plain (non-dual) codex init', async () => {
    await new CodexInitializer().initialize({ projectPath, template: 'minimal' });
    expect(read()).not.toContain('danger-full-access');
  });

  it('restores the permissive values only on explicit opt-in (codexTrust: full)', async () => {
    await new CodexInitializer().initialize({ projectPath, template: 'minimal', dual: true, codexTrust: 'full' });
    const toml = read();
    expect(toml).toMatch(/^sandbox_mode = "danger-full-access"$/m);
    expect(toml).toMatch(/^approval_policy = "never"$/m);
    expect(toml).toMatch(/^web_search = "live"$/m);
  });

  it('honours RUFLO_CODEX_TRUST=full as the config-level opt-in, and the explicit option wins', async () => {
    process.env.RUFLO_CODEX_TRUST = 'full';
    await new CodexInitializer().initialize({ projectPath, template: 'minimal' });
    expect(read()).toContain('danger-full-access');

    rmSync(join(projectPath, '.codex'), { recursive: true, force: true });
    rmSync(join(projectPath, 'AGENTS.md'), { force: true });
    await new CodexInitializer().initialize({ projectPath, template: 'minimal', force: true, codexTrust: 'standard' });
    expect(read()).not.toContain('danger-full-access');
  });

  it('falls back to the safe level (with a warning) for an unknown trust value', async () => {
    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'minimal',
      // @ts-expect-error deliberately invalid
      codexTrust: 'yolo',
    });
    expect(result.success).toBe(true);
    expect(read()).not.toContain('danger-full-access');
    expect((result.warnings ?? []).join('\n')).toMatch(/unknown codex trust "yolo"/i);
  });

  it('tells the person which mode they got and how to change it', async () => {
    const safe = await new CodexInitializer().initialize({ projectPath, template: 'minimal' });
    const note = (safe.warnings ?? []).find((w) => w.startsWith('.codex/config.toml:'));
    expect(note).toMatch(/workspace-write/);
    expect(note).toMatch(/--codex-trust full/);

    rmSync(join(projectPath, '.codex'), { recursive: true, force: true });
    rmSync(join(projectPath, 'AGENTS.md'), { force: true });
    const full = await new CodexInitializer().initialize({ projectPath, template: 'minimal', force: true, codexTrust: 'full' });
    const fullNote = (full.warnings ?? []).find((w) => w.startsWith('.codex/config.toml:'));
    expect(fullNote).toMatch(/danger-full-access/);
    expect(fullNote).toMatch(/--codex-trust standard/);
  });
});

describe('an existing .codex/config.toml is never rewritten', () => {
  const USER = '# my own settings\napproval_policy = "untrusted"\nsandbox_mode = "read-only"\n';

  it('keeps the user file byte for byte, even with --force, and says so', async () => {
    mkdirSync(join(projectPath, '.codex'), { recursive: true });
    writeFileSync(localConfig(), USER);
    const result = await new CodexInitializer().initialize({ projectPath, template: 'minimal', force: true });
    expect(result.success).toBe(true);
    expect(read()).toBe(USER);
    expect(result.filesCreated).not.toContain('.codex/config.toml');
    expect((result.warnings ?? []).join('\n')).toMatch(/\.codex\/config\.toml already exists - kept/);
  });

  it('keeps it even when the person asks for full trust (opt-in only affects new files)', async () => {
    mkdirSync(join(projectPath, '.codex'), { recursive: true });
    writeFileSync(localConfig(), USER);
    await new CodexInitializer().initialize({ projectPath, template: 'minimal', force: true, codexTrust: 'full' });
    expect(read()).toBe(USER);
  });

  it('warns when an older generated permissive file is kept', async () => {
    mkdirSync(join(projectPath, '.codex'), { recursive: true });
    writeFileSync(localConfig(), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\nweb_search = "live"\n');
    const result = await new CodexInitializer().initialize({ projectPath, template: 'minimal', force: true });
    expect(existsSync(localConfig())).toBe(true);
    expect((result.warnings ?? []).join('\n')).toMatch(/danger-full-access/);
  });
});
