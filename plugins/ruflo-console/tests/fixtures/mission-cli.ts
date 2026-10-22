import { cliAnswer, type Answer } from './world'

export const MISSION_ID = 'msn_0123456789abcdef01234567'

const out = (data: unknown): Answer => ({ exitCode: 0, stdout: `[INFO] Executing tool\nResult:\n${JSON.stringify(data, null, 2)}`, stderr: '' })

let counter = 0

/** The fake CLI for Mission Control: the mission and task tools answer as the real ones do (shapes captured from the CLI). */
export function missionCli(argv: readonly string[]): Answer {
  const at = argv.indexOf('-t')

  if (at < 0) return cliAnswer(argv)

  const tool = argv[at + 1]

  if (tool === 'aidefence_is_safe') return out({ safe: !/ignore (all )?previous instructions/i.test(String(argv[argv.indexOf('-p') + 1])), threats: [] })
  if (tool === 'aidefence_has_pii') return out({ hasPII: false })
  if (tool === 'mission_create') return out({ ok: true, data: { missionId: MISSION_ID, revision: 1, state: 'draft', deduplicated: false } })
  if (tool === 'mission_plan') return out({ ok: true, data: { missionId: MISSION_ID, revision: 2, state: 'planned', deduplicated: false, sequence: 2, planDigest: 'sha256:abc123' } })
  if (tool === 'task_create') return out({ taskId: `task-${++counter}`, success: true })
  if (tool === 'task_update' || tool === 'task_cancel') return out({ success: true })
  if (tool === 'mission_request_action') return out({ ok: false, code: 'invalid-transition', message: 'cancel.accepted is not permitted from planned' })

  return cliAnswer(argv)
}
