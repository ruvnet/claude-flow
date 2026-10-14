vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { output } from '../src/output.js';
import { callMCPTool } from '../src/mcp-client.js';
import { analyzeCommand } from '../src/commands/analyze.js';
import {
  assessFileRisk,
  assessOverallRisk,
  classifyDiff,
  suggestReviewers,
  type DiffFile,
} from '../src/ruvector/diff-classifier.js';

// Build the fixture with the classifier the analyze_diff MCP tool uses, so the
// test breaks if the renderer and the tool drift apart again.
function analyzeDiffResult(files: DiffFile[]) {
  const fileRisks = files.map(assessFileRisk);
  return {
    ref: 'HEAD~1',
    timestamp: Date.now(),
    files,
    risk: assessOverallRisk(files, fileRisks),
    classification: classifyDiff(files),
    fileRisks,
    recommendedReviewers: suggestReviewers(files, fileRisks),
    summary: `${files.length} files changed`,
  };
}

const files: DiffFile[] = [
  { path: 'src/auth/session.ts', status: 'modified', additions: 350, deletions: 20, hunks: 6, binary: false },
  { path: 'docs/notes.md', status: 'added', additions: 4, deletions: 0, hunks: 1, binary: false },
];

async function runDiff(flags: Record<string, unknown>) {
  const lines: string[] = [];
  vi.spyOn(output, 'writeln').mockImplementation((line = '') => { lines.push(String(line)); });
  const diff = analyzeCommand.subcommands!.find((c) => c.name === 'diff')!;
  const result = await diff.action!({ args: ['HEAD~1'], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false });
  return { result, printed: lines.join('\n') };
}

afterEach(() => vi.restoreAllMocks());

describe('analyze diff renders the analyze_diff result shape', () => {
  it('prints counts, risk breakdown and high-risk files without throwing', async () => {
    const fixture = analyzeDiffResult(files);
    vi.mocked(callMCPTool).mockResolvedValue(fixture);
    const { result, printed } = await runDiff({ risk: true });

    expect(result.success).toBe(true);
    expect(printed).toMatch(/Files Changed\s*\|\s*2\b/);
    expect(printed).toMatch(/Total Lines Changed\s*\|\s*374\b/);
    const highRisk = fixture.fileRisks.filter((r) => r.risk === 'high' || r.risk === 'critical');
    expect(highRisk.length).toBeGreaterThan(0);
    expect(printed).toContain('High Risk Files');
    expect(printed).toContain('src/auth/session.ts');
    expect(printed).not.toContain('undefined');
  });

  it('shows the classifier category in the summary and classification table', async () => {
    const fixture = analyzeDiffResult(files);
    vi.mocked(callMCPTool).mockResolvedValue(fixture);
    const { result, printed } = await runDiff({});

    expect(result.success).toBe(true);
    expect(printed).toContain(`Type: ${fixture.classification.primary}`);
    expect(printed).not.toContain('Type: undefined');
  });

  it('names the file in the verbose file-level table', async () => {
    vi.mocked(callMCPTool).mockResolvedValue(analyzeDiffResult(files));
    const { result, printed } = await runDiff({ verbose: true });

    expect(result.success).toBe(true);
    expect(printed).toContain('File-Level Analysis');
    expect(printed).toContain('docs/notes.md');
  });

  it('reports a tool error instead of rendering an empty analysis', async () => {
    vi.mocked(callMCPTool).mockResolvedValue({ error: true, message: 'bad ref', ref: 'nope' });
    const errors: string[] = [];
    vi.spyOn(output, 'printError').mockImplementation((message: string) => { errors.push(message); });
    const diff = analyzeCommand.subcommands!.find((c) => c.name === 'diff')!;
    const result = await diff.action!({ args: ['nope'], flags: { _: [] }, cwd: process.cwd(), interactive: false });

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(errors.join('\n')).toContain('bad ref');
  });
});
