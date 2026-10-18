#!/usr/bin/env node
import { runHeldoutEvaluation } from '../lib/ecosystem-heldout-evaluation.mjs';

const result = await runHeldoutEvaluation({
  resolveFrom: process.env.RUFLO_MEMORY_RESOLVE_FROM,
  harnessResolveFrom: process.env.RUFLO_HARNESS_RESOLVE_FROM,
  weightResolveFrom: process.env.RUFLO_WEIGHT_EFT_RESOLVE_FROM,
});
console.log(JSON.stringify(result));
if (!result.accepted) process.exitCode = 1;
