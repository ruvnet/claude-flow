#!/usr/bin/env node
/** Validate proposer-visible public task statements without admitting evaluator data. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateFreshTaskFreeze } from './fresh-task-admission.mjs';

const MAX_PROMPT_BYTES = 65536;
const assert = (condition, reason) => { if (!condition) throw Error(reason); };
const digest = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys, reason) => assert(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), reason);

export function validatePromptBytes(task, bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length === task.prompt.capsuleBytes &&
    bytes.length <= MAX_PROMPT_BYTES, 'task prompt byte count');
  assert(digest(bytes) === task.prompt.capsuleSha256, 'task prompt digest');
  const prompt = JSON.parse(bytes.toString('utf8'));
  exact(prompt, ['schema','taskId','repository','issueNumber','issueUrl','title','body','state','comments',
    'createdAt','updatedAt','capturedAt','visibility','selectedBeforeProposal','fixDataAcquired',
    'outcomeRead','candidateExecutionEnabled','boundedRsiEvidenceAccepted'], 'task prompt fields');
  assert(prompt.schema === 'ruflo.public-task-spec/v1' && prompt.taskId === task.id &&
    prompt.repository === task.repository, 'task prompt identity');
  assert(prompt.issueNumber === task.prompt.issueNumber && prompt.issueUrl === task.prompt.sourceUrl,
    'task prompt issue identity');
  assert(typeof prompt.title === 'string' && prompt.title.length >= 10 && prompt.title.length <= 200,
    'bounded task prompt title');
  assert(typeof prompt.body === 'string' && prompt.body.length >= 200 && prompt.body.length <= 50000,
    'bounded task prompt body');
  assert(prompt.body.includes(task.source.baseCommit), 'task prompt must bind the frozen base');
  assert(prompt.state === 'open' && prompt.comments === 0, 'task prompt must remain pre-claim');
  const created = Date.parse(prompt.createdAt), updated = Date.parse(prompt.updatedAt), captured = Date.parse(prompt.capturedAt);
  assert(Number.isFinite(created) && Number.isFinite(updated) && Number.isFinite(captured) &&
    created <= updated && updated <= captured, 'task prompt timestamps');
  assert(prompt.visibility === task.prompt.visibility && prompt.selectedBeforeProposal === true &&
    prompt.fixDataAcquired === false && prompt.outcomeRead === false, 'task prompt provenance');
  assert(prompt.candidateExecutionEnabled === false && prompt.boundedRsiEvidenceAccepted === false,
    'task prompt cannot enable execution or RSI');
  return structuredClone(prompt);
}

export function inspectFreshTaskPrompts(manifestPath, artifactRoot) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const admission = validateFreshTaskFreeze(manifest);
  const prompts = manifest.tasks.map(task => {
    const root = resolve(artifactRoot), path = resolve(root, task.id, 'task-spec.json');
    assert(path.startsWith(`${root}/`), 'task prompt path escaped root');
    const prompt = validatePromptBytes(task, readFileSync(path));
    return { taskId: task.id, issueUrl: prompt.issueUrl, title: prompt.title,
      promptSha256: task.prompt.capsuleSha256, proposerVisible: true };
  });
  return { schema: 'ruflo.fresh-task-prompt-inspection/v1', freezeHash: admission.freezeHash,
    prompts, candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [manifestPath, artifactRoot, extra] = process.argv.slice(2);
    if (!manifestPath || !artifactRoot || extra) throw Error('usage: fresh-task-prompt.mjs MANIFEST ARTIFACT_ROOT');
    console.log(JSON.stringify(inspectFreshTaskPrompts(resolve(manifestPath), resolve(artifactRoot)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
