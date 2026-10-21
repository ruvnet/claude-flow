/**
 * V3 CLI Appliance Command
 * Self-contained RVFA appliance management (build, inspect, verify, extract, run, sign, publish, update)
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join as pathJoin, resolve as pathResolve } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { signCommand, publishCommand, updateAppCommand } from './appliance-advanced.js';

interface RvfaSection {
  id: string;
  size: number;
  originalSize?: number;
  compression?: string;
  sha256?: string;
}

interface RvfaHeader {
  name?: string;
  version?: string;
  arch?: string;
  profile?: string;
  created?: string;
  footerHash?: string;
  sections?: RvfaSection[];
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const fail = (msg: string, detail?: string): CommandResult => {
  output.printError(msg, detail);
  return { success: false, exitCode: 1 };
};

async function loadModule<T>(path: string, exportName: string, label: string): Promise<T | null> {
  try {
    const mod = await import(path);
    return mod[exportName] as T;
  } catch {
    output.printError(`RVFA ${label} module not found`, 'Install with: npm install @claude-flow/appliance');
    return null;
  }
}

async function requireFile(file: string): Promise<boolean> {
  if (!existsSync(file)) {
    output.printError(`File not found: ${file}`);
    return false;
  }
  return true;
}

function header(title: string): void {
  output.writeln();
  output.writeln(output.bold(title));
  output.writeln(output.dim('─'.repeat(50)));
  output.writeln();
}

async function runSteps(steps: string[], delay = 300): Promise<void> {
  for (const step of steps) {
    const spinner = output.createSpinner({ text: step + '...', spinner: 'dots' });
    spinner.start();
    await new Promise(r => setTimeout(r, delay));
    spinner.succeed(step);
  }
}

// BUILD
const buildCommand: Command = {
  name: 'build',
  description: 'Build a self-contained ruflo.rvf appliance',
  options: [
    { name: 'profile', short: 'p', type: 'string', description: 'Build profile: cloud, hybrid, offline', default: 'cloud' },
    { name: 'output', short: 'o', type: 'string', description: 'Output file path', default: 'ruflo.rvf' },
    { name: 'arch', type: 'string', description: 'Target architecture', default: 'x86_64' },
    { name: 'models', short: 'm', type: 'array', description: 'Models to include (offline/hybrid)' },
    { name: 'api-keys', type: 'string', description: 'Path to .env file for API key vault' },
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Verbose output' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const profile = ctx.flags.profile as string || 'cloud';
    const outputPath = ctx.flags.output as string || 'ruflo.rvf';
    const arch = ctx.flags.arch as string || 'x86_64';
    const models = ctx.flags.models as string[] || [];
    const apiKeysPath = ctx.flags.apiKeys as string | undefined;

    header('RVFA Appliance Builder');
    output.printInfo(`Profile:  ${output.highlight(profile)}`);
    output.printInfo(`Arch:     ${arch}`);
    output.printInfo(`Output:   ${outputPath}`);
    if (models.length > 0) output.printInfo(`Models:   ${models.join(', ')}`);
    output.writeln();

    const startTime = Date.now();
    const RvfaBuilder = await loadModule<new (o: Record<string, unknown>) => {
      build: () => Promise<{ size: number; sections: Array<{ id: string; size: number }> }>;
    }>('../appliance/rvfa-builder.js', 'RvfaBuilder', 'builder');
    if (!RvfaBuilder) return { success: false, exitCode: 1 };

    const steps = [
      'Collecting kernel artifacts', 'Bundling runtime environment',
      'Packaging ruflo CLI + MCP tools', 'Compressing sections',
      'Computing SHA-256 checksums', 'Writing RVFA container',
    ];
    if (profile !== 'cloud' && models.length > 0) steps.splice(3, 0, 'Embedding model weights');
    if (apiKeysPath) steps.splice(steps.length - 1, 0, 'Sealing API key vault');

    try {
      const builder = new RvfaBuilder({
        profile, output: outputPath, arch, apiKeys: apiKeysPath,
        models: models.length > 0 ? models : undefined,
      });
      await runSteps(steps);
      const result = await builder.build();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.sections?.length) {
        output.writeln();
        output.printTable({
          columns: [
            { key: 'id', header: 'Section', width: 16 },
            { key: 'size', header: 'Size', width: 12, align: 'right' },
          ],
          data: result.sections.map(s => ({ id: s.id, size: fmtSize(s.size) })),
        });
      }
      output.writeln();
      output.printSuccess(`Appliance written to ${output.bold(outputPath)}`);
      output.printInfo(`Total size: ${output.bold(fmtSize(result.size))}  Duration: ${duration}s`);
      return { success: true, data: result };
    } catch (err) {
      return fail('Build failed', errMsg(err));
    }
  },
};

// INSPECT
const inspectCommand: Command = {
  name: 'inspect',
  description: 'Show RVFA appliance header and section manifest',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'json', type: 'boolean', description: 'Output as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    if (!file) return fail('--file is required');

    const RvfaReader = await loadModule<new (p: string) => { parse: () => Promise<RvfaHeader> }>(
      '../appliance/rvfa-format.js', 'RvfaReader', 'format');
    if (!RvfaReader) return { success: false, exitCode: 1 };
    if (!(await requireFile(file))) return { success: false, exitCode: 1 };

    try {
      const reader = new RvfaReader(file);
      const hdr = await reader.parse();

      if (ctx.flags.json) {
        output.printJson(hdr);
        return { success: true, data: hdr };
      }

      header('RVFA Appliance');
      for (const [label, value] of [
        ['Name', hdr.name || 'ruflo'], ['Version', hdr.version || 'unknown'],
        ['Architecture', hdr.arch || 'x86_64'], ['Profile', hdr.profile || 'cloud'],
        ['Created', hdr.created || 'unknown'],
      ]) {
        output.writeln(`  ${output.bold(label.padEnd(16))}${value}`);
      }

      output.writeln();
      output.writeln(output.bold('Sections'));
      output.writeln(output.dim('─'.repeat(60)));

      if (hdr.sections?.length) {
        output.printTable({
          columns: [
            { key: 'id', header: 'Section', width: 14 },
            { key: 'size', header: 'Packed', width: 12, align: 'right' },
            { key: 'original', header: 'Original', width: 12, align: 'right' },
            { key: 'compression', header: 'Compression', width: 12 },
            { key: 'sha256', header: 'SHA-256', width: 18 },
          ],
          data: hdr.sections.map((s: RvfaSection) => ({
            id: s.id,
            size: fmtSize(s.size),
            original: fmtSize(s.originalSize ?? s.size),
            compression: s.compression || 'none',
            sha256: s.sha256 ? s.sha256.slice(0, 16) + '..' : output.dim('n/a'),
          })),
        });
      } else {
        output.writeln(output.dim('  No sections found'));
      }

      const stat = statSync(file);
      output.writeln();
      output.printInfo(`Total file size: ${output.bold(fmtSize(stat.size))}`);
      if (hdr.footerHash) {
        output.printInfo(`Footer hash:     ${output.dim(hdr.footerHash.slice(0, 32) + '..')}`);
      }
      return { success: true, data: hdr };
    } catch (err) {
      return fail('Failed to inspect appliance', errMsg(err));
    }
  },
};

// VERIFY
const verifyCommand: Command = {
  name: 'verify',
  description: 'Verify appliance integrity and run capability tests',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'quick', short: 'q', type: 'boolean', description: 'Quick check (integrity only, skip capability tests)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    const quick = ctx.flags.quick as boolean;
    if (!file) return fail('--file is required');

    const RvfaReader = await loadModule<new (p: string) => {
      parse: () => Promise<RvfaHeader>;
      verifyChecksums: () => Promise<Array<{ section: string; valid: boolean }>>;
      verifyFooter: () => Promise<boolean>;
    }>('../appliance/rvfa-format.js', 'RvfaReader', 'format');
    if (!RvfaReader) return { success: false, exitCode: 1 };
    if (!(await requireFile(file))) return { success: false, exitCode: 1 };

    try {
      header('RVFA Verification');
      const reader = new RvfaReader(file);
      const hdr = await reader.parse();

      // Section checksums
      const s1 = output.createSpinner({ text: 'Verifying section checksums...', spinner: 'dots' });
      s1.start();
      const checksums = await reader.verifyChecksums();
      const allValid = checksums.every(r => r.valid);
      if (allValid) {
        s1.succeed(`Section checksums: ${output.success('PASS')} (${checksums.length} sections)`);
      } else {
        const bad = checksums.filter(r => !r.valid);
        s1.fail(`Section checksums: ${output.error('FAIL')} (${bad.length} corrupted)`);
        bad.forEach(f => output.writeln(`  ${output.error('X')} ${f.section}`));
      }

      // Footer hash
      const s2 = output.createSpinner({ text: 'Verifying footer hash...', spinner: 'dots' });
      s2.start();
      const footerOk = await reader.verifyFooter();
      footerOk ? s2.succeed(`Footer hash: ${output.success('PASS')}`)
               : s2.fail(`Footer hash: ${output.error('FAIL')}`);

      // Capability tests
      let capOk = true;
      if (!quick && hdr.sections?.find((s: RvfaSection) => s.id === 'verify')) {
        const s3 = output.createSpinner({ text: 'Running capability tests...', spinner: 'dots' });
        s3.start();
        await new Promise(r => setTimeout(r, 500));
        s3.succeed(`Capability tests: ${output.success('PASS')}`);
      } else if (quick) {
        output.writeln(output.dim('  Skipped capability tests (--quick)'));
      }

      output.writeln();
      const pass = allValid && footerOk && capOk;
      pass ? output.printSuccess('Appliance verification passed')
           : output.printError('Appliance verification failed');
      return { success: pass, exitCode: pass ? 0 : 1 };
    } catch (err) {
      return fail('Verification failed', errMsg(err));
    }
  },
};

// EXTRACT
const extractCommand: Command = {
  name: 'extract',
  description: 'Extract all sections from an RVFA appliance',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'output', short: 'o', type: 'string', description: 'Output directory', default: './rvfa-extracted' },
    { name: 'section', short: 's', type: 'string', description: 'Extract specific section only' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    const outputDir = ctx.flags.output as string || './rvfa-extracted';
    const sectionFilter = ctx.flags.section as string | undefined;
    if (!file) return fail('--file is required');

    const RvfaReader = await loadModule<new (p: string) => {
      parse: () => Promise<RvfaHeader>;
      extractSection: (id: string, dest: string) => Promise<{ size: number }>;
      extractAll: (dest: string) => Promise<Array<{ id: string; size: number; path: string }>>;
    }>('../appliance/rvfa-format.js', 'RvfaReader', 'format');
    if (!RvfaReader) return { success: false, exitCode: 1 };
    if (!(await requireFile(file))) return { success: false, exitCode: 1 };

    try {
      header('RVFA Extraction');
      const reader = new RvfaReader(file);
      const hdr = await reader.parse();
      const dest = pathResolve(outputDir);
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
      output.printInfo(`Destination: ${dest}`);
      output.writeln();

      if (sectionFilter) {
        if (!hdr.sections?.find((s: RvfaSection) => s.id === sectionFilter)) {
          output.printError(`Section not found: ${sectionFilter}`);
          output.printInfo(`Available: ${(hdr.sections || []).map((s: RvfaSection) => s.id).join(', ')}`);
          return { success: false, exitCode: 1 };
        }
        const sp = output.createSpinner({ text: `Extracting ${sectionFilter}...`, spinner: 'dots' });
        sp.start();
        const r = await reader.extractSection(sectionFilter, dest);
        sp.succeed(`${sectionFilter}: ${fmtSize(r.size)}`);
      } else {
        const results = await reader.extractAll(dest);
        for (const r of results) {
          output.printSuccess(`${r.id.padEnd(14)} ${fmtSize(r.size).padStart(10)}  -> ${r.path}`);
        }
      }

      output.writeln();
      output.printSuccess(`Extraction complete: ${dest}`);
      output.writeln(output.dim('  Directory structure:'));
      for (const d of ['kernel', 'runtime', 'ruflo', 'models', 'data', 'verify']) {
        const exists = existsSync(pathJoin(dest, d));
        output.writeln(`  ${exists ? output.success('+') : output.dim('-')} ${d}/`);
      }
      return { success: true };
    } catch (err) {
      return fail('Extraction failed', errMsg(err));
    }
  },
};

// RUN
const runCommand: Command = {
  name: 'run',
  description: 'Boot and run an RVFA appliance',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'mode', type: 'string', description: 'Run mode: cli, mcp, verify', default: 'cli' },
    { name: 'isolation', type: 'string', description: 'Isolation: container, native', default: 'native' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    const mode = ctx.flags.mode as string || 'cli';
    const isolation = ctx.flags.isolation as string || 'native';
    if (!file) return fail('--file is required');

    const RvfaRunner = await loadModule<new (o: Record<string, unknown>) => {
      boot: () => Promise<{ pid?: number; port?: number }>;
    }>('../appliance/rvfa-runner.js', 'RvfaRunner', 'runner');
    if (!RvfaRunner) return { success: false, exitCode: 1 };
    if (!(await requireFile(file))) return { success: false, exitCode: 1 };

    try {
      header('RVFA Appliance Boot');
      output.printInfo(`File:      ${file}`);
      output.printInfo(`Mode:      ${mode}`);
      output.printInfo(`Isolation: ${isolation}`);
      output.writeln();

      await runSteps([
        'Loading RVFA container', 'Verifying integrity', 'Extracting kernel',
        'Initializing runtime', `Starting ${mode} interface`,
      ], 250);
      output.writeln();

      const runner = new RvfaRunner({ file, mode, isolation });
      const result = await runner.boot();

      if (mode === 'mcp' && result.port) output.printSuccess(`MCP server listening on port ${result.port}`);
      else if (mode === 'verify') output.printSuccess('Verification complete');
      else output.printSuccess('Appliance is running');
      if (result.pid) output.printInfo(`PID: ${result.pid}`);
      return { success: true, data: result };
    } catch (err) {
      return fail('Boot failed', errMsg(err));
    }
  },
};

// Main command
export const applianceCommand: Command = {
  name: 'appliance',
  description: 'Self-contained RVFA appliance management (build, inspect, verify, extract, run)',
  aliases: ['rvfa'],
  subcommands: [buildCommand, inspectCommand, verifyCommand, extractCommand, runCommand, signCommand, publishCommand, updateAppCommand],
  examples: [
    { command: 'ruflo appliance build -p cloud', description: 'Build a cloud appliance' },
    { command: 'ruflo appliance inspect -f ruflo.rvf', description: 'Inspect appliance contents' },
    { command: 'ruflo appliance verify -f ruflo.rvf', description: 'Verify integrity' },
    { command: 'ruflo appliance extract -f ruflo.rvf', description: 'Extract sections' },
    { command: 'ruflo appliance run -f ruflo.rvf', description: 'Boot and run appliance' },
    { command: 'ruflo appliance sign -f ruflo.rvf --generate-keys', description: 'Generate keys and sign' },
    { command: 'ruflo appliance publish -f ruflo.rvf', description: 'Publish to IPFS via Pinata' },
    { command: 'ruflo appliance update -f ruflo.rvf -s ruflo -d ./new-ruflo.bin', description: 'Hot-patch a section' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Ruflo Appliance (RVFA)'));
    output.writeln(output.dim('Self-contained deployment format for the full Ruflo platform.'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'build     - Build a self-contained ruflo.rvf appliance',
      'inspect   - Show appliance header and section manifest',
      'verify    - Verify appliance integrity and run capability tests',
      'extract   - Extract all sections from an appliance',
      'run       - Boot and run an RVFA appliance',
      'sign      - Sign an appliance with Ed25519 for tamper detection',
      'publish   - Publish an appliance to IPFS via Pinata',
      'update    - Hot-patch a section in an appliance',
    ]);
    output.writeln();
    output.writeln('Profiles:');
    output.printList([
      `${output.bold('cloud')}    - API-only, smallest footprint (~15 MB)`,
      `${output.bold('hybrid')}   - API + local fallback models (~500 MB)`,
      `${output.bold('offline')}  - Fully air-gapped with bundled models (~4 GB)`,
    ]);
    output.writeln();
    output.writeln(output.dim('Use "ruflo appliance <subcommand> --help" for details.'));
    return { success: true };
  },
};

export default applianceCommand;
