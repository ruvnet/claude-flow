/**
 * The last wash a run gets before the page, a notice or a slot sees it (ADR-464). The parsers already drop control
 * characters from file text; this adds the credential mask to every free-text field (labels, phase titles, models,
 * the last tool, a result preview), so a token a prompt or a result carried can reach no cell, log line or notice.
 * Ids, paths and numbers are left alone: a session id is 36 characters of `[0-9a-f-]` and would read as a key to the mask.
 */
import { ESCAPES, HIDDEN, INVISIBLE } from './parse'
import { maskSecrets, type WfAgent, type WfPhase, type WfRun } from './workflows'

/** Free text for a cell or a notice: escape sequences are dropped whole, control, zero-width and bidi characters become spaces, credentials are masked. */
export const cleanText = (value: string): string => maskSecrets(value.replace(ESCAPES, '').replace(INVISIBLE, '').replace(HIDDEN, ' '))

const opt = (value: string | undefined): string | undefined => (value === undefined ? undefined : cleanText(value))

function cleanAgent(agent: WfAgent): WfAgent {
  const model = opt(agent.model)
  const preview = opt(agent.resultPreview)
  const tool = opt(agent.lastTool)

  const ruflo = agent.ruflo === undefined ? undefined : { ...agent.ruflo, ...(agent.ruflo.name !== undefined && { name: cleanText(agent.ruflo.name) }), type: cleanText(agent.ruflo.type) }

  return { ...agent, ...(ruflo !== undefined && { ruflo }), label: cleanText(agent.label), phase: cleanText(agent.phase), ...(model !== undefined && { model }), ...(preview !== undefined && { resultPreview: preview }), ...(tool !== undefined && { lastTool: tool }) }
}

function cleanPhase(phase: WfPhase): WfPhase {
  const detail = opt(phase.detail)

  return { ...phase, title: cleanText(phase.title), ...(detail !== undefined && { detail }), agents: phase.agents.map(cleanAgent) }
}

export const cleanRun = (run: WfRun): WfRun => ({ ...run, name: cleanText(run.name), phases: run.phases.map(cleanPhase) })
