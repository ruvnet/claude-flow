import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const base = fileURLToPath(new URL('.', import.meta.url));
const baseline = JSON.parse(readFileSync(resolve(base, 'baseline-audit.json'), 'utf8'));
const candidate = JSON.parse(readFileSync(resolve(base, 'candidate-audit.json'), 'utf8'));
const receipt = JSON.parse(readFileSync(resolve(base, 'native-remediation-receipt.json'), 'utf8'));
const key = (item) => `${item.advisory.id}:${item.package.name}:${item.package.version}`;
const before = baseline.vulnerabilities.list.map(key).sort();
const after = candidate.vulnerabilities.list.map(key).sort();
const removed = before.filter((entry) => !after.includes(entry));
assert.deepEqual(removed, receipt.nativeAudit.removedAdvisories.map((id) => `${id}:rustls:0.23.45`).sort());
assert.equal(after.length, 9);
assert.deepEqual(after.filter((entry) => !before.includes(entry)), []);
assert.deepEqual(candidate.warnings, baseline.warnings, 'warning evidence must not disappear');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(hash(process.argv[3] ?? resolve(base, 'baseline-Cargo.lock')), receipt.baselineLockSha256);
assert.equal(hash(process.argv[2]), receipt.candidateLockSha256);
for (const variant of ['baseline', 'candidate']) {
  // Git text artifacts add one terminal newline to the original single-line
  // cargo-audit output. Compare the original payload bytes, not that separator.
  const payload = readFileSync(resolve(base, `${variant}-audit.json`), 'utf8').replace(/\n$/, '');
  assert.equal(createHash('sha256').update(payload).digest('hex'), receipt.nativeAudit[`${variant}ReportSha256`]);
  assert.equal(hash(resolve(base, `${variant}-core-tests.log`)), receipt.regressions[variant].logSha256);
}
console.log(JSON.stringify({ checks: 10, removedAdvisories: removed, remainingInstances: after.length, gate: 'FAIL: ZIP remains' }));
