#!/usr/bin/env node
// Exercise the shipped stdio launchers, not MCPServerManager's in-process handler.
// Only the large tool registry is stubbed; the policy module is transpiled from
// the same TypeScript source that the package build ships.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policySource = readFileSync(join(packageDir, 'src/mcp-tools/policy-enforcer.ts'), 'utf8');
const policyJavaScript = ts.transpileModule(policySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const toolStub = `
import { appendFileSync } from 'node:fs';
export const hasTool = (name) => name === 'demo_tool';
export const listMCPTools = () => [{ name: 'demo_tool', description: 'test', inputSchema: {} }];
export async function callMCPTool(name) {
  appendFileSync('executions.txt', name + '\\n');
  return { ran: true };
}
`;

async function runSession(entry, { policy, enforce = true, calls = 1, badAuditPath = false, customAuditPath = false }) {
  const project = mkdtempSync(join(tmpdir(), 'ruflo-stdio-policy-'));
  let child;
  try {
    const bin = join(project, 'bin');
    const dist = join(project, 'dist/src');
    mkdirSync(bin);
    mkdirSync(join(dist, 'mcp-tools'), { recursive: true });
    writeFileSync(join(project, 'package.json'), '{"type":"module"}');
    copyFileSync(join(packageDir, 'bin', entry), join(bin, entry));
    writeFileSync(join(dist, 'mcp-client.js'), toolStub);
    writeFileSync(join(dist, 'mcp-tools/policy-enforcer.js'), policyJavaScript);
    if (policy !== undefined) {
      mkdirSync(join(project, '.harness'));
      writeFileSync(join(project, '.harness/mcp-policy.json'), policy);
    }

    const configuredAudit = customAuditPath ? 'custom/audit.jsonl' : '';
    if (badAuditPath) writeFileSync(join(project, 'audit-parent-file'), 'not a directory');
    child = spawn(process.execPath, [join(bin, entry), ...(entry === 'cli.js' ? ['mcp', 'start'] : [])], {
      cwd: project,
      env: {
        ...process.env,
        RUFLO_MCP_ENFORCE_POLICY: enforce ? '1' : '0',
        RUFLO_MCP_AUDIT_LOG_PATH: badAuditPath ? join(project, 'audit-parent-file/log.jsonl') : configuredAudit,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    const responses = [];
    for (let id = 1; id <= calls; id++) {
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'demo_tool', arguments: {} },
      }) + '\n');
      let timeout;
      const line = await Promise.race([
        output.next(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`${entry} timed out: ${stderr}`)), 5000);
        }),
      ]).finally(() => clearTimeout(timeout));
      assert.equal(line.done, false, `${entry} exited before responding: ${stderr}`);
      responses.push(JSON.parse(line.value));
    }
    child.stdin.end();
    assert.equal(await closed, 0, `${entry} exited abnormally: ${stderr}`);
    const executionsPath = join(project, 'executions.txt');
    const auditPath = join(project, configuredAudit || '.claude-flow/logs/mcp-audit.jsonl');
    return {
      responses,
      segments: [auditPath, `${auditPath}.1`, `${auditPath}.2`, `${auditPath}.3`].filter(existsSync).map(file => ({ path: file, bytes: Buffer.byteLength(readFileSync(file)), records: readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) })),
      executions: existsSync(executionsPath) ? readFileSync(executionsPath, 'utf8').trim().split('\n') : [],
      audit: existsSync(auditPath) ? readFileSync(auditPath, 'utf8').trim().split('\n').map(JSON.parse) : [],
    };
  } finally {
    if (child && child.exitCode === null) child.kill();
    rmSync(project, { recursive: true, force: true });
  }
}

for (const entry of ['cli.js', 'mcp-server.js']) {
  test(`${entry}: disabled policy leaves calls working without a policy file`, async () => {
    const result = await runSession(entry, { enforce: false });
    assert.equal(result.responses[0].result.content[0].type, 'text');
    assert.deepEqual(result.executions, ['demo_tool']);
    assert.deepEqual(result.audit, []);
  });

  test(`${entry}: enabled policy denies a missing or malformed file before execution`, async () => {
    for (const policy of [undefined, '{ malformed']) {
      const result = await runSession(entry, { policy });
      assert.equal(result.responses[0].error.code, -32001);
      assert.match(result.responses[0].error.message, /missing or invalid.*failing closed/i);
      assert.deepEqual(result.executions, []);
    }
  });

  test(`${entry}: audit and sliding call budget govern real stdio requests`, async () => {
    const result = await runSession(entry, {
      policy: JSON.stringify({ auditLog: true, maxToolCallsPerTurn: 1 }), calls: 2,
    });
    assert.equal(result.responses[0].result.content[0].type, 'text');
    assert.equal(result.responses[1].error.code, -32001);
    assert.match(result.responses[1].error.message, /maxToolCallsPerTurn/);
    assert.deepEqual(result.executions, ['demo_tool']);
    assert.deepEqual(result.audit.map(record => record.allowed), [true, false]);
  });

  test(`${entry}: configured audit logs rotate in a real stdio session`, async () => {
    const result = await runSession(entry, { policy: JSON.stringify({ auditLog: true, auditLogMaxBytes: 512, auditLogMaxFiles: 2 }), calls: 10, customAuditPath: true });
    assert.equal(result.executions.length, 10);
    assert.equal(result.segments.length, 3);
    assert.ok(result.segments.every(segment => segment.bytes <= 512));
    assert.ok(result.segments.every(segment => segment.records.every(record => record.projectPath && record.allowed)));
  });

  test(`${entry}: mandatory audit failure denies before execution`, async () => {
    const result = await runSession(entry, {
      policy: JSON.stringify({ auditLog: true }), badAuditPath: true,
    });
    assert.equal(result.responses[0].error.code, -32001);
    assert.match(result.responses[0].error.message, /audit log write failed.*failing closed/i);
    assert.deepEqual(result.executions, []);
  });
}
