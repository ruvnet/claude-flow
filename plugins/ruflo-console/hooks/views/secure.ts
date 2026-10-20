import type { RenderElement } from 'claude-code'

import { countText, DOCTOR_COMPONENTS, isSecureResult, SECURE, SECURE_TEXT, secMemo, SEVERITIES, type SecCost, type Severity } from '../secure'
import { slot } from './attention'
import { spinAt } from '../spinner'
import { sentryRows } from './sentries'
import { anatoleMeterLine, anatoleSection } from './anatole'
import { ago, button, clip, col, type Ctx, row, rule, section, tagChip, text, THEME } from './common'
import { frameResult } from './status-card'

/** Result lines in view at once; j/k scroll the rest. */
export const RESULT_ROWS = 14

/** Each cost as a four-cell tag: $0 reads, local writes, and what reaches the network. */
const TAG: Record<SecCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  writes: { text: ' wr ', color: () => THEME.info },
  network: { text: 'net ', color: () => THEME.warn },
}

export const COST_KEY = ' $0 local read, runs at once · wr writes a file · net reaches the network: each of these asks, its cost on the confirm row'

/** One dotted-leader row: the cost tag, the name, what it does, and its ▸ run button (with the field's text, if it takes one). */
export function entryRow(ctx: Ctx, entry: { id: string; name: string; about: string; cost: SecCost }, textOf?: () => string, isReady?: () => boolean): RenderElement {
  const lead = Math.max(14, Math.min(19, ctx.columns - 40))
  const tag = TAG[entry.cost]
  // A row that takes the field's text cannot run on an empty or refused field: its button dims and the row says what to do first.
  const waiting = isReady !== undefined && !isReady()

  return row(
    ctx,
    [
      tagChip(ctx, tag.text, tag.color()),
      ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${entry.name} `.padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: waiting, wrap: 'truncate-end', children: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 34)) }),
      // The run is the row's one action, so it is a primary button: it is the first thing the eye finds. Waiting on text, it is plain.
      ctx.kit.Button({ key: `run-${entry.id}`, label: ' ▶ run ', ...(waiting ? { plain: true, dimColor: true } : { variant: 'primary' as const }), onPress: () => void ctx.act.run(entry.id, textOf?.() ?? '') }),
      ...(waiting ? [ctx.kit.Text({ bold: true, color: THEME.warn, children: ' ← type text above first' })] : []),
    ],
    `row-${entry.id}`,
  )
}

/**
 * Under a result: hands it to the main Claude session. The page's text, this result included, goes as quoted data with secrets
 * removed (the ADR 411 bridge: it asks first and says it starts a billed turn), and the question asks what to do about it, so a run
 * leads somewhere: a fix, a follow-up command, a setting to change.
 */
export function sendResultRow(ctx: Ctx, key: string): RenderElement {
  return row(
    ctx,
    [
      button(ctx, key, '✦ send result to Claude', () => ctx.act.ask.ask('Explain this result, then tell me what to fix, run or change next, with the exact ruflo command or setting.'), { primary: true }),
      text(ctx, ' quoted as data, secrets removed; asks first', { dimColor: true }),
    ],
    `${key}-row`,
  )
}

/** The triage question: the page text carries only the counts (and is capped), so it sends Claude to the report the scan wrote. */
export const FINDINGS_QUESTION =
  'Triage these security findings. Read the newest report in .claude/security-scans/ yourself (the counts here are only a summary), group the findings by root cause, separate real defects from false positives, and propose a fix for each real one with the exact change. Do not edit any file until I approve.'

/** Under the findings meter: hands the findings to the main Claude session to triage (the ADR 411 bridge: quoted data, secrets removed, asks first). */
export function sendFindingsRow(ctx: Ctx): RenderElement {
  return row(
    ctx,
    [
      button(ctx, 'findings-send', '✦ send findings to Claude', () => ctx.act.ask.ask(FINDINGS_QUESTION), { primary: true }),
      text(ctx, ' the counts go as quoted data; Claude reads the report itself and edits nothing until you approve', { dimColor: true }),
    ],
    'findings-send-row',
  )
}

/** A verb the CLI does not have, said as such rather than invented. */
export const naRow = (ctx: Ctx, name: string, why: string): RenderElement => text(ctx, `  n/a  ${name.padEnd(14, '.')} ${why}`, { dimColor: true })

/** The last run of this view's verbs: what it was, how it exited, its cost note, and a window of its lines. */
export function resultRows(ctx: Ctx, isMine: (id: string) => boolean): RenderElement[] {
  const { state, nowMs } = ctx
  const running = state.lab.running !== null && isMine(state.lab.running.id) ? state.lab.running : null
  const result = state.lab.result !== null && isMine(state.lab.result.id) ? state.lab.result : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) rows.push(text(ctx, ` ${spinAt(nowMs)} ${running.label} · ${Math.round((nowMs - running.startedAtMs) / 1000)}s`, { color: THEME.warn }))

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ run an entry: a $0 read shows here at once; the rest show here after you confirm (y)', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - RESULT_ROWS))
  const tone = (line: string) => (/^(✗|\[critical\]|\[high\]|UNSAFE|ATTENTION|error)/.test(line) ? THEME.bad : /^(⚠|\[medium\]|PII FOUND|REVIEW)/.test(line) ? THEME.warn : /^(✓|SAFE|CLEAN)/.test(line) ? THEME.ok : undefined)

  for (const line of result.lines.slice(top, top + RESULT_ROWS)) {
    const color = tone(line)

    rows.push(text(ctx, `   ${line}`, color === undefined ? {} : { color }))
  }

  if (result.lines.length > RESULT_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + RESULT_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'result-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'result-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  rows.push(sendResultRow(ctx, 'result-send'))

  return slot(ctx, [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')])
}

const SEVERITY_COLOR: Record<Severity, () => string> = { critical: () => THEME.bad, high: () => THEME.bad, medium: () => THEME.warn, low: () => THEME.info }

/** The last findings by severity as bars, each scaled to the largest count. */
export function meterRows(ctx: Ctx): RenderElement[] {
  const findings = secMemo(ctx.state).findings
  const rows: RenderElement[] = []

  if (findings === null) {
    rows.push(text(ctx, ' ▸ a scan, a channel/plan check or a paste check fills this meter with its findings by severity', { dimColor: true }))

    return rows
  }

  const most = Math.max(1, ...SEVERITIES.map(level => findings.counts[level]))
  const width = Math.max(8, Math.min(40, ctx.columns - 30))

  for (const level of SEVERITIES) {
    const n = findings.counts[level]
    const filled = n === 0 ? 0 : Math.max(1, Math.round((n / most) * width))

    rows.push(
      row(ctx, [
        ctx.kit.Text({ bold: n > 0, color: n > 0 ? SEVERITY_COLOR[level]() : THEME.info, dimColor: n === 0, children: ` ${level.padEnd(9)}` }),
        ctx.kit.Text({ color: SEVERITY_COLOR[level](), children: '█'.repeat(filled) }),
        ctx.kit.Text({ dimColor: true, children: `${'░'.repeat(width - filled)} ${countText(findings, level)}` }),
      ], `meter-${level}`),
    )
  }

  return rows
}

/** The paste field: Enter runs the local check at once; the buttons run the other checks on the same text. */
function pasteRows(ctx: Ctx): RenderElement[] {
  const memo = secMemo(ctx.state)
  const rows: RenderElement[] = []

  if (ctx.kit.Input !== undefined) {
    // In a round border, like the other views' fields (loops, missions, events): the field is the first thing the eye finds, and the buttons below act on it.
    rows.push(
      ctx.kit.Box({
        key: 'sec-text-box',
        borderStyle: 'round',
        borderColor: THEME.info,
        paddingX: 1,
        children: [
          ctx.kit.Input({
            key: 'sec-text',
            label: 'text',
            placeholder: 'paste a prompt, a message or a plan: Enter checks it locally (it is passed as one argv value)',
            value: memo.draft,
            submitLabel: 'check',
            onInput: value => {
              memo.draft = value
            },
            onSubmit: value => {
              memo.draft = value
              void ctx.act.run('aid-check', value)
            },
          }),
        ],
      }),
    )
  } else {
    rows.push(text(ctx, ' this surface has no text field: /ruflo run aid-check <text> checks text headless', { dimColor: true }))
  }

  for (const entry of SECURE_TEXT) rows.push(entryRow(ctx, entry, () => memo.draft, () => entry.argv(memo.draft) !== null))
  rows.push(text(ctx, ' ▸ run takes the text in the field; policy-eval takes an action type (deploy, tool:Bash) and asks first', { dimColor: true }))

  return rows
}

/** The doctor: the full run and --fix, one button per local component, then the last run's checks as ✓/⚠/✗ rows. */
function doctorRows(ctx: Ctx): RenderElement[] {
  const doctor = secMemo(ctx.state).doctor
  const rows: RenderElement[] = []

  for (const entry of SECURE.filter(candidate => candidate.id === 'doc-all' || candidate.id === 'doc-fix')) rows.push(entryRow(ctx, entry))

  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      flexWrap: 'wrap',
      key: 'doc-components',
      children: [ctx.kit.Text({ bold: true, color: THEME.ok, children: '  $0  component:' }), ...DOCTOR_COMPONENTS.map(component => ctx.kit.Button({ key: `run-doc-${component}`, label: ` ${component}`, plain: true, dimColor: true, onPress: () => void ctx.act.run(`doc-${component}`) }))],
    }),
  )

  if (doctor === null) {
    rows.push(text(ctx, ' ▸ a component runs at once and locally; the full doctor asks first (its version check asks npm)', { dimColor: true }))

    return rows
  }

  const count = (status: string) => doctor.checks.filter(check => check.status === status).length

  rows.push(text(ctx, ` ${count('pass')} passed · ${count('warn')} warnings · ${count('fail')} failed`, { bold: true, color: count('fail') > 0 ? THEME.bad : count('warn') > 0 ? THEME.warn : THEME.ok }))

  for (const check of doctor.checks.slice(0, 30)) {
    const mark = check.status === 'pass' ? { glyph: '✓', color: THEME.ok } : check.status === 'warn' ? { glyph: '⚠', color: THEME.warn } : { glyph: '✗', color: THEME.bad }

    rows.push(
      row(ctx, [
        ctx.kit.Text({ bold: true, color: mark.color, children: ` ${mark.glyph} ` }),
        ctx.kit.Text({ bold: check.status !== 'pass', children: clip(`${check.name}: `, 40) }),
        ctx.kit.Text({ dimColor: check.status === 'pass', wrap: 'truncate-end', children: clip(check.message, Math.max(4, ctx.columns - check.name.length - 8)) }),
      ], `check-${check.name}`),
    )
  }

  return rows
}

/**
 * Security & Doctor: the findings meter, a paste field for AIDefence, every security verb by cost, the doctor with its
 * checks, and the last run's output. Nothing runs on open; a $0 read runs on its button, the rest ask first.
 */
export function secureView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const memo = secMemo(state)
  const findings = memo.findings
  const doctor = memo.doctor
  const running = state.lab.running !== null && isSecureResult(state.lab.running.id) ? state.lab.running : null
  const doctorBusy = running !== null && running.id.startsWith('doc-')
  const scanBusy = running !== null && !doctorBusy
  const fails = doctor === null ? 0 : doctor.checks.filter(check => check.status === 'fail').length
  const warns = doctor === null ? 0 : doctor.checks.filter(check => check.status === 'warn').length
  const scanRows: RenderElement[] = [
    ...SECURE.filter(candidate => candidate.group === 'scan').map(entry => entryRow(ctx, entry)),
    naRow(ctx, 'VALIDATE', 'no `security validate` in the CLI: the check text field above is the input check'),
    naRow(ctx, 'REPORT', 'no `security report` in the CLI: a scan writes .claude/security-scans/<scan>.json'),
    text(ctx, COST_KEY, { dimColor: true }),
  ]

  // Each part is a section. The findings are open; the check field and the scans fold; the doctor opens when a check failed or
  // warned, or while it runs. Each header names its state, so the page reads without opening anything.
  const rows: RenderElement[] = [
    ...section(
      ctx,
      'sec-findings',
      'Findings',
      findings === null ? 'none measured yet' : `${SEVERITIES.map(level => `${countText(findings, level)} ${level}`).join(' · ')}${(findings.unreadable ?? []).length > 0 ? ' · counts unreadable' : ''} · ${ago(findings.atMs, nowMs)}`,
      [...meterRows(ctx), ...anatoleMeterRows(ctx), ...(findings === null ? [] : [sendFindingsRow(ctx)])],
      true,
    ),
    ...anatoleSection(ctx),
    ...sentryRows(ctx),
    // Open: the text field lives here, and the checks below it read what is typed; folded, the field would be out of reach.
    ...section(ctx, 'sec-check', 'Check text', memo.draft === '' ? 'type or paste text, then run a check' : `${memo.draft.length} characters ready`, pasteRows(ctx), true),
    ...section(ctx, 'sec-scan', 'Scan & inspect', scanBusy ? `${spinAt(nowMs)} ${running?.label ?? 'scanning'}` : 'scans are local; npm audit is the network', scanRows, scanBusy),
    ...section(
      ctx,
      'sec-doctor',
      'Doctor',
      doctor === null ? 'not run yet' : `${doctor.label} · ${fails} failed · ${warns} warnings · ${ago(doctor.atMs, nowMs)}`,
      doctorRows(ctx),
      doctorBusy || fails > 0 || warns > 0,
    ),
    ...resultRows(ctx, isSecureResult),
  ]

  return col(ctx, rows, 'secure')
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const secureResult = (ctx: Ctx): RenderElement[] => resultRows(ctx, isSecureResult)

/** Open Project Anatole alerts by severity, labelled as the mod's report and kept apart from the scan's own counts. */
function anatoleMeterRows(ctx: Ctx): RenderElement[] {
  const line = anatoleMeterLine(ctx.state.snapshot?.anatole)

  return line === null ? [] : [text(ctx, ` ${line}`, { color: THEME.warn })]
}
