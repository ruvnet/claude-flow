#!/usr/bin/env node
import { resolve } from 'node:path';
import { listCandidateProposals, prepareCandidate, evaluateCandidate, releaseCandidate } from './lib/ecosystem-candidate.mjs';
const [action, ...args] = process.argv.slice(2);
const options = { repoRoot: process.cwd(), allowedPaths: [] };
const keys = { '--repo': 'repoRoot', '--expected-head': 'expectedHead', '--proposal': 'proposal', '--destination-root': 'destinationRoot', '--bundle': 'bundle', '--max-duration-ms': 'maxDurationMs' };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i], value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
  if (key === '--allow') options.allowedPaths.push(value);
  else if (keys[key]) options[keys[key]] = key === '--max-duration-ms' ? Number(value) : value;
  else throw new Error(`Unknown argument ${key}`);
}
options.repoRoot = resolve(options.repoRoot);
const actions = { list: listCandidateProposals, prepare: prepareCandidate, evaluate: evaluateCandidate, release: releaseCandidate };
if (!actions[action]) throw new Error('Expected list, prepare, evaluate or release');
const result = await actions[action](options);
console.log(JSON.stringify(action === 'evaluate' ? { bundle: options.bundle, status: result.status, candidateTree: result.candidateTree, rollback: result.rollback, baselineChecksPassed: result.baseline.checksPassed, candidateChecksPassed: result.candidate.checksPassed, promotionAllowed: false } : result, null, 2));
if (action === 'evaluate' && result.status !== 'checks-passed-review-required') process.exitCode = 1;
