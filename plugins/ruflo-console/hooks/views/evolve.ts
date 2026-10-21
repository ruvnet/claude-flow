import type { RenderElement } from 'claude-code'

import { shortRef, type Manifest, type Receipt } from '../data/evolve'
import { candidateReceipt, EVOLVE, evolveSpec, PROMOTE_COMMAND, REPOS, type EvolveEntry } from '../evolve'
import { lineageOf, loopStagesOf, type LineageRow } from '../gfx/evolve'
import { slot } from './attention'
import { ago, button, clip, col, kv, picture, row, rule, text, THEME, type Ctx } from './common'
import { frameResult } from './status-card'

/** Result lines in view at once; j/k scroll the rest. */
const RESULT_ROWS = 12
const RECEIPTS_SHOWN = 8

const entryOf = (id: string): EvolveEntry | undefined => EVOLVE.find(entry => entry.id === id)

/** One check as a dotted row: its cost tag, its name, what it does, and its ▸ button (dim when it cannot run now). */
function entryRow(ctx: Ctx, id: string): RenderElement | null {
  const entry = entryOf(id)

  if (entry === undefined) return null

  const lead = Math.max(14, Math.min(18, ctx.columns - 40))
  const isBlocked = evolveSpec(entry, ctx.state) === null

  return row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color: entry.cost === 'read' ? THEME.ok : THEME.info, children: entry.cost === 'read' ? '  $0 ' : '  wr ' }),
      ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${entry.name} `.padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: isBlocked, wrap: 'truncate-end', children: clip(` ${isBlocked ? (entry.why ?? entry.about) : entry.about}`, Math.max(4, ctx.columns - lead - 16)) }),
      ctx.kit.Button({ key: `evolve-${entry.id}`, label: entry.cost === 'read' ? ' ▸ run' : ' ▸ ask', plain: true, dimColor: true, onPress: () => void ctx.act.run(entry.id) }),
    ],
    `evolve-row-${entry.id}`,
  )
}

const rows = (ctx: Ctx, ids: readonly string[]): RenderElement[] => ids.flatMap(id => entryRow(ctx, id) ?? [])

function loopRows(ctx: Ctx): RenderElement[] {
  const stages = loopStagesOf(ctx.state.evolve)
  const words = stages.map(stage => `${stage.mark === 'lit' ? '●' : stage.mark === 'bad' ? '✗' : '○'} ${stage.name} ${stage.value}`).join(' → ')
  const unknown = stages.filter(stage => stage.mark === 'na')

  return [
    rule(ctx, 'Loop', 'observe → propose → evaluate → verify → promote → reverse'),
    picture(ctx, 'evolve-loop', ` ${words}`),
    ...(unknown.length > 0 ? [text(ctx, ` n/a: ${unknown.map(stage => `${stage.name.toLowerCase()} (${stage.source})`).join(' · ')}`, { dimColor: true })] : []),
  ]
}

function receiptLine(ctx: Ctx, receipt: Receipt): RenderElement {
  const verdict = receipt.decision ?? 'undecided'
  const color = receipt.decision === 'accepted' ? THEME.ok : receipt.decision === 'rejected' ? THEME.bad : THEME.warn
  const lift = receipt.lift === undefined ? '' : ` · lift ${receipt.lift >= 0 ? '+' : ''}${(receipt.lift * 100).toFixed(1)}%`

  return row(ctx, [
    ctx.kit.Text({ bold: true, color, children: `   ${receipt.decision === 'accepted' ? '✓' : receipt.decision === 'rejected' ? '✗' : '?'} ${shortRef(receipt.id)} ` }),
    ctx.kit.Text({ color, children: verdict.padEnd(9) }),
    ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: clip(` ${receipt.isSigned ? 'signed' : 'UNSIGNED'} · ${receipt.status ?? 'unregistered'} · ${shortRef(receipt.baseline)} → ${shortRef(receipt.candidate)}${lift} · ${ago(receipt.atMs, ctx.nowMs)}`, Math.max(4, ctx.columns - 24)) }),
  ])
}

function ledgerRows(ctx: Ctx): RenderElement[] {
  const { evolve } = ctx.state
  const files = evolve.files
  const flywheel = files?.flywheel ?? null
  const ledger = evolve.ledger
  const out: RenderElement[] = [rule(ctx, 'Ledger & receipts', '.claude-flow/flywheel-v1 · ADR-322')]

  out.push(
    kv(ctx, 'ledger', ledger === null ? 'n/a: not verified yet (▸ LEDGER checks it)' : `${ledger.isValid ? 'VALID' : 'INVALID'} · ${ledger.commits} commits · head ${shortRef(ledger.head)} · ${ago(ledger.atMs, ctx.nowMs)}`, ledger === null ? undefined : ledger.isValid ? THEME.ok : THEME.bad),
  )
  for (const error of ledger?.errors ?? []) out.push(text(ctx, `   ✗ ${error}`, { color: THEME.bad }))
  out.push(kv(ctx, 'champion', flywheel === null ? 'n/a: no transaction-state.json' : `${shortRef(flywheel.champion)} · serving epoch ${flywheel.epoch ?? 'n/a'} · served ${shortRef(flywheel.served)}`))

  const receipts = files?.receipts ?? null

  if (receipts === null) out.push(text(ctx, ' receipts: n/a (no receipts folder): ▸ FLYWHEEL RUN in the MetaHarness lab evaluates candidates into receipts', { dimColor: true }))
  else if (receipts.length === 0) out.push(text(ctx, ' receipts: none yet', { dimColor: true }))
  else out.push(text(ctx, ` receipts: ${receipts.length} newest${receipts.length >= 20 ? ' (of more)' : ''} · ${receipts.filter(receipt => receipt.decision === 'accepted').length} accepted · ${receipts.filter(receipt => !receipt.isSigned).length} unsigned`, { color: THEME.info }))

  for (const receipt of (receipts ?? []).slice(0, RECEIPTS_SHOWN)) out.push(receiptLine(ctx, receipt))

  out.push(...rows(ctx, ['evolve-ledger', 'evolve-receipts', 'evolve-history']))
  out.push(text(ctx, ' per-receipt signature check: n/a here, ruflo runs it only inside promote · autogenous verifier: n/a (a library, nothing built)', { dimColor: true }))

  return out
}

function treeLine(ctx: Ctx, line: LineageRow): RenderElement {
  const color = line.kind === 'champion' ? THEME.ok : line.kind === 'rejected' ? THEME.bad : line.kind === 'pending' ? THEME.warn : line.kind === 'root' ? THEME.head : THEME.info
  const glyph = line.kind === 'champion' ? '★' : line.kind === 'rejected' ? '✗' : line.kind === 'pending' ? '◌' : line.kind === 'root' ? '◇' : '●'

  return row(ctx, [
    ctx.kit.Text({ dimColor: true, children: `   ${line.prefix}` }),
    ctx.kit.Text({ bold: line.kind === 'champion', color, children: `${glyph} ${line.ref === 'root' ? 'root' : shortRef(line.ref)}${line.kind === 'champion' ? ' champion' : ''} ` }),
    ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: clip(line.note, Math.max(4, ctx.columns - line.prefix.length - 24)) }),
  ])
}

function lineageRows(ctx: Ctx): RenderElement[] {
  const files = ctx.state.evolve.files
  const lineage = lineageOf(files)
  const out: RenderElement[] = [rule(ctx, 'Lineage', '★ champion · ● promoted · ◌ accepted, waiting · ✗ rejected')]

  out.push(text(ctx, ' flywheel-v1 (promotion commits and receipts):', { color: THEME.info }))
  if (lineage.flywheel.length === 0) out.push(text(ctx, `   n/a: ${files?.flywheel === null && files?.receipts === null ? 'no flywheel-v1 files' : 'no promotions or receipts yet (the ledger is at genesis)'}`, { dimColor: true }))
  for (const line of lineage.flywheel) out.push(treeLine(ctx, line))

  out.push(text(ctx, ' generations (.claude-flow/flywheel, each bundle’s parent):', { color: THEME.info }))
  if (lineage.generations.length === 0) out.push(text(ctx, '   n/a: no generation-N.json bundles', { dimColor: true }))
  for (const line of lineage.generations) out.push(treeLine(ctx, line))

  return out
}

function policyRows(ctx: Ctx): RenderElement[] {
  const { evolve } = ctx.state
  const policy = evolve.files?.policy ?? null
  const ledger = evolve.policyLedger
  const gate = evolve.gate
  const out: RenderElement[] = [rule(ctx, 'Policies', 'harness-active-policy.json · ADR-324 gate')]

  out.push(kv(ctx, 'active policy', policy === null ? 'n/a: no .claude-flow/harness-active-policy.json' : `${shortRef(policy.champion)} · ${policy.tier ?? 'tier n/a'} · ${policy.layer ?? 'layer n/a'} · applied ${ago(policy.appliedAtMs, ctx.nowMs)}`))
  if (policy !== null) out.push(kv(ctx, 'rollback', policy.isRolledBack ? `rolled back to ${shortRef(policy.previous)}` : policy.previous !== undefined ? `armed: previous ${shortRef(policy.previous)} (the generations loop rolls back on a regression; no CLI verb)` : 'no previous pointer'))
  out.push(kv(ctx, 'policy engine', ledger === null ? 'n/a: not asked yet (▸ POLICY)' : `mode ${ledger.mode} · ${ledger.rules} rules · ${ledger.approvals} approvals · ${ledger.receipts} receipts · ledger ${ledger.isValid ? 'verifies' : 'DOES NOT VERIFY'}`, ledger === null ? undefined : ledger.isValid ? THEME.ok : THEME.bad))
  out.push(kv(ctx, 'promote gate', gate === null ? `n/a: not asked yet (▸ GATE CHECK${candidateReceipt(evolve.files) !== undefined ? ` about receipt ${shortRef(candidateReceipt(evolve.files))}` : ''})` : `${gate.enforced} in ${gate.mode} mode · ${gate.reason || 'no reason given'} · ${ago(gate.atMs, ctx.nowMs)}`, gate === null ? undefined : gate.enforced === 'allowed' ? THEME.ok : THEME.warn))
  out.push(...rows(ctx, ['evolve-policy', 'evolve-gate']))
  out.push(text(ctx, ' policy_status / policy_evaluate are the same engine; the CLI verbs are used because mcp exec adds a ledger receipt per call', { dimColor: true }))

  return out
}

function manifestLine(ctx: Ctx, manifest: Manifest): RenderElement {
  const witness = ctx.state.evolve.witness[manifest.os]
  const result = witness === undefined ? 'not verified yet' : `${witness.isSignatureValid ? 'signature valid' : 'SIGNATURE FAILS'} · ${witness.pass} pass · ${witness.drift} drift · ${witness.regressed} regressed · ${witness.missing} missing · ${ago(witness.atMs, ctx.nowMs)}`
  const color = witness === undefined ? THEME.info : witness.isSignatureValid && witness.regressed === 0 ? THEME.ok : THEME.bad

  return kv(ctx, `${manifest.os}`, `${manifest.isSigned ? 'signed' : 'UNSIGNED'} · ${manifest.fixes ?? 'n/a'} fixes · ${manifest.branch ?? 'n/a'} @ ${manifest.gitCommit ?? 'n/a'} · issued ${ago(manifest.issuedAtMs, ctx.nowMs)} · ${result}`, color)
}

function witnessRows(ctx: Ctx): RenderElement[] {
  const manifests = ctx.state.evolve.files?.manifests ?? []
  const out: RenderElement[] = [rule(ctx, 'Witness', 'verification/<os>/manifest.md.json · ADR-103 · read-only')]

  if (manifests.length === 0) out.push(text(ctx, ' n/a: no signed witness manifest in this project (verification/<os>/manifest.md.json)', { dimColor: true }))

  for (const manifest of manifests) out.push(manifestLine(ctx, manifest))

  out.push(...rows(ctx, manifests.map(manifest => `evolve-witness-${manifest.os}`)))
  if (manifests.length > 0) out.push(text(ctx, ' each fix is checked against the installed @claude-flow/cli; a manifest from another OS may drift here', { dimColor: true }))

  return out
}

function whereRows(ctx: Ctx): RenderElement[] {
  const hasRgiDb = ctx.state.evolve.files?.hasRgiDb ?? false
  const ask = (repo: keyof typeof REPOS) => button(ctx, `evolve-ask-${repo}`, `▸ ask about ${repo === 'rgi' ? 'rGi' : 'Autogenous'}`, () => ctx.act.evolve.ask(repo))

  return [
    rule(ctx, 'What runs where', 'integrated here · only linked'),
    text(ctx, ` Autogenous · ${REPOS.autogenous}`, { bold: true, color: THEME.head }),
    text(ctx, '   integrated: the receipt format. ruflo writes ruflo.flywheel-receipt/v1, the schema autogenous’s radio-moe exports and verifies;', { color: THEME.ok }),
    text(ctx, '     fractional policy values are decimal strings so its stricter verifier accepts them (ruvnet/autogenous#15).', { color: THEME.ok }),
    text(ctx, '   linked only: its verifier (crates/verifier, verifyExportedReceipt) is a library with no binary or build here: n/a;', { dimColor: true }),
    text(ctx, '     autogenous-service (HTTP :8080, /v1/agl/admit, /v1/promote) is not built or running here; AGL/AAP are its protocols.', { dimColor: true }),
    row(ctx, [ask('autogenous')]),
    text(ctx, ` rGi · ${REPOS.rgi}`, { bold: true, color: THEME.head }),
    text(ctx, '   linked only: a perpetual runtime (observe → plan → admit → execute → record) holding the enduring cognitive policies;', { dimColor: true }),
    text(ctx, `     its state is SQLite .rgi/runtime.db: ${hasRgiDb ? 'present here (never opened)' : 'not in this project'}; its CLI needs a checkout: none here, so n/a.`, { dimColor: true }),
    text(ctx, '   ruflo stays the execution authority (manifesto §6): neither repo can promote here.', { dimColor: true }),
    row(ctx, [ask('rgi')]),
    text(ctx, ' ▸ ask types a read-only research prompt into the AI terminal (claude); Enter twice sends it, nothing opens a browser', { dimColor: true }),
  ]
}

function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const running = state.lab.running?.id.startsWith('evolve-') === true ? state.lab.running : null
  const result = state.lab.result?.id.startsWith('evolve-') === true ? state.lab.result : null
  const out: RenderElement[] = [rule(ctx, 'Result', running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`)]

  if (running !== null) out.push(text(ctx, ` ▸ ${running.label} …`, { color: THEME.warn }))
  if (result === null) {
    if (running === null) out.push(text(ctx, ' ▸ run a check: a $0 read answers here at once; ▸ ask shows its command and runs after you confirm (y)', { dimColor: true }))

    return [frameResult(ctx, out, running !== null ? 'run' : 'idle')]
  }

  out.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) out.push(text(ctx, ` ${result.note}`, { color: THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - RESULT_ROWS))

  for (const line of result.lines.slice(top, top + RESULT_ROWS)) out.push(text(ctx, `   ${line}`))
  if (result.lines.length > RESULT_ROWS) out.push(row(ctx, [text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + RESULT_ROWS)} of ${result.lines.length} `, { dimColor: true }), button(ctx, 'evolve-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'evolve-down', 'down', () => ctx.act.select(1), { hotkey: 'j' })]))

  return slot(ctx, [frameResult(ctx, out, result.ok ? 'ok' : 'bad')])
}

/**
 * Self-Evolution: the governed loop as ruflo recorded it (flywheel receipts, ledger, champion, promotions, rollback
 * pointer), its lineage, the policy gate and the witness manifest, each check a button; Autogenous and rGi as what is
 * integrated and what is only linked. Promotion is a command the person runs, never a button.
 */
export function evolveView(ctx: Ctx): RenderElement {
  const { evolve } = ctx.state
  const status = evolve.isReading ? 'reading the flywheel files…' : evolve.files === null ? 'not read yet' : `files read ${ago(evolve.files.readAtMs, ctx.nowMs)}`

  return col(
    ctx,
    [
      row(ctx, [text(ctx, ` ${status} `, { dimColor: true }), button(ctx, 'evolve-reread', 'Reread', () => ctx.act.evolve.reread()), button(ctx, 'evolve-lab', 'MetaHarness lab: run candidates', () => ctx.act.view('metaharness'))]),
      ...loopRows(ctx),
      ...ledgerRows(ctx),
      ...lineageRows(ctx),
      ...policyRows(ctx),
      ...witnessRows(ctx),
      ...whereRows(ctx),
      ...resultRows(ctx),
      rule(ctx, 'Promote', 'a person’s act · never from this pane'),
      text(ctx, ' The flywheel, Darwin and MetaHarness propose and evaluate; none may promote itself (ADR-322). Review the receipt, then run:', { color: THEME.info }),
      text(ctx, `   ${PROMOTE_COMMAND}`, { bold: true, color: THEME.warn }),
      text(ctx, ' It needs an approved Ed25519 public key and --confirm, and it passes the policy gate (▸ GATE CHECK asks that gate first).', { dimColor: true }),
    ],
    'evolve',
  )
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const evolveResult = (ctx: Ctx): RenderElement[] => resultRows(ctx)
