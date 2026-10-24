# Equal-mechanics control materialization result

Decision: accept this engineering increment only. Inherited, frozen, static,
shuffled and previous now use the same two-descriptor-to-two-artifact mechanism.
This removes unequal patch availability but does not execute a repair, use a fresh
task, measure improvement capacity or establish RSI.

Source `d2d5ae350da1f32e557e4525e22b36b6ae5c8fbd` at tree
`cac254d57ab5b4c73aa90d726f5a5010d0690246` binds plan
`a7a8df26ef90d815824234e064ea611fc926502f0eb904af81aade258df9287e`.
Reservation `b4a8e3c9529aed4e62d7efc56ca41473b4052eec` is retained at SHA-256
`ae1680febfca9a968b9bc8c0b00905beb8ec8d1ff3a8fcdda11f909c77031457`.

Three registered batches all reproduced artifact-set hash
`5c04725baac4e91913e9e7c7bcd826682f3947a7f88b509120516057a70556ce`
in 269.091035, 245.850848 and 248.260956 ms: 763.202839 ms summed
batch time. They charged 15 child spawn attempts, observed 15 completions and
retained 30 artifacts. Child and parent sides each constructed 30 descriptors,
30 artifacts and 30 replacements, performed 30 training-only scores, and read
49725 base-source bytes. Parent plan reads are observed; child plan reads are
charged upper bounds. Module-loader bytes, outer Codex cost and total engineering
dollars remain unknown. Repair evaluations, isolated starts, native calls, epochs,
model calls and provider spend were zero.

The templates are researcher-authored from the exposed p-limit task. Duplicate
candidates are preserved, including generation-zero frozen/previous degeneracy,
and the inherited/shuffled selections may share the known-fix family. Artifact
count is equal; candidate byte costs and outcomes are not claimed equal. This is
calibration infrastructure, not experimental learning.

Read-only review reproduced undercounted parent reconstruction, lost failed-spawn
costs, observed-versus-charged read ambiguity and a blocking FIFO input. The
corrected implementation charges attempts, retains failures and unknown work,
separates child/parent construction, labels read upper bounds, and opens plan inputs
nonblocking. Final review found no remaining high or medium issue.

The mission remains at 209784 native calls, seven epochs and ledger head
`5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e`.
Next requires frozen fresh tasks, candidate staging on a compatible isolated runner,
equal acquisition/execution budgets and explicit approval for 36 evaluations, 216
isolated starts and 1080000 summed process ms.

## Acceptance

```bash
node --test --test-isolation=none v3/@claude-flow/cli/scripts/rsi/repair/control-materializer.test.mjs
```

Expected: fourteen passes with repair execution, fresh-task evidence,
improvement-capacity measurement and RSI acceptance false.
