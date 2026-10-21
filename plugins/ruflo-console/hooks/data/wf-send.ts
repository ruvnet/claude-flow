/**
 * How one message reaches one target, and how its answer comes back (ADR-465). Every transport is an injected function (`SendDeps`), so a
 * test passes fakes and asserts the exact payload; nothing here touches `$`. `payloadOf` is what the confirm card shows and `sendTo` is
 * what runs after it, built from the same strings: the card can never show something other than what is sent. Secrets: a message that
 * looks like it holds a credential is refused before either; a key is read from the NAMED environment variable at send time, rides one
 * header, and is masked out of anything drawn, logged or saved (including the provider's own reply).
 */
import { ARGV_TEXT_MAX } from '../full-text'
import { exec } from '../actions'
import { OPERATOR, hivePropose } from '../hive'
import type { Host } from '../host'
import { callTool, permissionOf } from './wf-control'
import { cleanText } from './wf-clean'
import { guardText } from './wf-guide'
import { idOf, plain, type HiveInfo } from './parse'
import { endpointsOf, type Config, type Endpoint, type Target } from './wf-targets'

export type SendDeps = Pick<Host, 'toolCall' | 'toolCheck' | 'run' | 'httpSend' | 'submitPrompt'> & {
  /** `ruflo mcp exec` is `[...cli, 'mcp', 'exec', ...]`. */
  cli: readonly string[]
  /** Where the federation helper script is, and whether the peer is trusted (an untrusted one gets the helper's own --confirm, which the person's confirm card stands for). */
  helper: string
  trustedPeers: ReadonlySet<string>
  cwd: string
  hive: HiveInfo | null
  config: Config
}

export type SendState = 'reply' | 'queued' | 'sent' | 'error' | 'refused'

/** `tokensTotal` is for a provider that reports one figure without a split (the codex CLI's "tokens used"). */
export type SendResult = { ok: boolean; state: SendState; text: string; tokensIn?: number; tokensOut?: number; tokensTotal?: number; costUsd?: number; model?: string }

export type Payload = { shows: string; note: string }

const REPLY_CAP = 4000
const WAIT = { peer: 600_000, codex: 300_000, cli: 60_000, http: 120_000 }

const err = (state: SendState, text: string): SendResult => ({ ok: false, state, text: tidy(text, 300).trim() })

/** Text from outside: escapes and control characters out, credentials masked, capped. */
export const tidy = (value: string, max = REPLY_CAP): string => cleanText(value).slice(0, max)

/** The body checked: plain, bounded, no leading dash, nothing that looks like a credential. */
export const bodyOf = (value: string, max = ARGV_TEXT_MAX): { ok: true; text: string } | { ok: false; why: string } => guardText(value, max)

const endpointOf = (target: Target, config: Config): Endpoint | undefined => endpointsOf(config).find(held => held.name === target.ref)

/** `task-12 the note`: the first word is the id, the rest the note. */
export function taskNote(body: string): { id: string; note: string } | null {
  const [first = '', ...rest] = body.trim().split(/\s+/)
  const id = /\d/.test(first) ? idOf(first) : null
  const note = rest.join(' ').trim()

  return id === null || note === '' ? null : { id, note }
}

/** The exact request body an OpenAI-compatible endpoint is sent; OpenRouter is also asked for the cost it billed (other servers may reject the field). */
export function chatBody(endpoint: Endpoint, body: string): string {
  return JSON.stringify({ model: endpoint.model, messages: [{ role: 'user', content: body }], ...(new URL(endpoint.baseUrl).hostname.endsWith('openrouter.ai') && { usage: { include: true } }) })
}

/** What the confirm card shows for this send, or null where the target cannot take it (with the reason in `why`). */
export function payloadOf(target: Target, raw: string, deps: Pick<SendDeps, 'config' | 'hive' | 'cwd'>): { ok: true; payload: Payload; body: string } | { ok: false; why: string } {
  const typed = bodyOf(raw)

  if (!typed.ok) return typed

  const body = typed.text
  const done = (shows: string, note: string): { ok: true; payload: Payload; body: string } => ({ ok: true, payload: { shows, note }, body })

  switch (target.transport) {
    case 'prompt':
      return done(`to Claude in this session, as a visible prompt: "${body}"`, 'Starts a turn of this session (billed as any turn is). Its answer is the next turn in the transcript.')
    case 'send-message':
      return done(`SendMessage ${JSON.stringify({ to: target.ref, message: body })}`, 'The engine puts it in the agent\'s inbox and delivers it when the agent\'s current turn ends (measured 161 and 165 s into a running agent\'s loop, Claude Code 2.1.289); the agent then acted on it within 2 s, and any tool it runs raises its own permission dialog.')
    case 'hive': {
      if (deps.hive === null) return { ok: false, why: 'there is no hive-mind to write to' }

      if (target.ref === 'propose') {
        const spec = hivePropose(deps.hive, body)

        return spec === null ? { ok: false, why: 'a proposal is not possible now (raft allows one open proposal per term) or the text cannot be passed' } : done(`ruflo ${spec.args.join(' ')}`, 'Opens a proposal the workers vote on. A pass binds no agent to do anything.')
      }

      return done(`ruflo mcp exec -t hive-mind_broadcast ${JSON.stringify({ message: body, priority: 'normal', fromId: OPERATOR })}`, 'Appended to the hive shared memory (the last 100). No worker is interrupted.')
    }
    case 'task': {
      const note = taskNote(body)

      return note === null ? { ok: false, why: 'start with the task id, then the note: @task task-12 what the agent should know' } : done(`ruflo mcp exec -t task_update ${JSON.stringify({ taskId: note.id, result: { guidance: note.note } })}`, 'Writes the task record\'s result; an agent sees it only when it reads the task.')
    }
    case 'bbs':
      return done(`ruflo mcp exec -t federation_bbs_publish ${JSON.stringify({ roomId: target.ref, msgType: 'human-message', payload: { text: body, from: 'ruflo-console' } })}`, 'Appended to the room log; peers get it where the room syncs.')
    case 'x-channel':
      return done(`ruflo mcp exec -t x_federation_channel_publish ${JSON.stringify({ channel: target.ref, msgType: 'Status', payload: { text: body, from: 'ruflo-console' } })}`, `${target.ref.startsWith('prv:') ? 'Encrypted under the channel key' : 'PUBLIC: anyone on the relay can read it'}. Signed with your key. Never put secrets in it.`)
    case 'peer':
      return done(`bash federation.sh dispatch ${target.ref} ${JSON.stringify(body)}${/\(not trusted/.test(target.label) ? ' --confirm' : ''}`, `Runs \`claude -p\` on ${target.ref} with that machine's own permissions and files; the helper blocks destructive prompts and audits the dispatch.`)
    case 'codex':
      return done(`codex exec -s read-only --skip-git-repo-check --ephemeral -C ${deps.cwd} -  (prompt on stdin: ${JSON.stringify(body)})`, 'Read-only sandbox: Codex can read files here and cannot write them. Its answer is the final message.')
    case 'http': {
      const endpoint = endpointOf(target, deps.config)

      return endpoint === undefined ? { ok: false, why: `no endpoint named ${target.ref}` } : done(`POST ${endpoint.baseUrl}/chat/completions${endpoint.keyEnv === 'NONE' ? '' : `  Authorization: Bearer ‹from $${endpoint.keyEnv}›`}\n${chatBody(endpoint, body)}`, 'The key is read from the named variable, sent in one header and never shown or stored. Metered by the provider.')
    }
  }
}

async function viaCli(deps: SendDeps, tool: string, params: Record<string, unknown>): Promise<SendResult> {
  const result = await deps.run([...deps.cli, 'mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)], WAIT.cli).catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : 'refused' }))
  const failed = result.exitCode !== 0 || /"success"\s*:\s*false|"isError"\s*:\s*true|\[ERROR\]/.test(result.stdout)

  return failed ? err('error', result.stderr.trim() !== '' ? result.stderr : result.stdout) : { ok: true, state: 'sent', text: tidy(plain(result.stdout, 300)) || 'ruflo answered ok' }
}

/** The answer of an OpenAI-compatible reply: text, tokens and the cost the provider itself billed (never one this code works out). */
export function parseChat(text: string, secret?: string): SendResult {
  let json: { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown }; model?: unknown; error?: { message?: unknown } } | undefined

  try {
    json = JSON.parse(text) as typeof json
  } catch {
    return err('error', 'the endpoint did not answer with JSON')
  }

  const content = json?.choices?.[0]?.message?.content

  if (typeof content !== 'string') return err('error', typeof json?.error?.message === 'string' ? `the endpoint refused: ${scrub(json.error.message, secret)}` : 'the endpoint answered without a message')

  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)

  return { ok: true, state: 'reply', text: scrub(content, secret), ...(num(json?.usage?.prompt_tokens) !== undefined && { tokensIn: num(json?.usage?.prompt_tokens) as number }), ...(num(json?.usage?.completion_tokens) !== undefined && { tokensOut: num(json?.usage?.completion_tokens) as number }), ...(num(json?.usage?.cost) !== undefined && { costUsd: num(json?.usage?.cost) as number }), ...(typeof json?.model === 'string' && { model: tidy(json.model, 80) }) }
}

/** Masks the key's own text wherever it appears (a provider may echo a header), then the usual credential shapes. */
export const scrub = (value: string, secret?: string): string => tidy(secret === undefined || secret.length < 6 ? value : value.split(secret).join('‹masked›'))

/** Sends one message. The engine's permission, the confirm card and the person's choice come BEFORE this; nothing here retries by another route. */
export async function sendTo(deps: SendDeps, target: Target, raw: string): Promise<SendResult> {
  const made = payloadOf(target, raw, deps)

  if (!made.ok) return err('refused', made.why)

  const body = made.body

  switch (target.transport) {
    case 'prompt':
      await deps.submitPrompt(body)

      return { ok: true, state: 'sent', text: 'submitted as a visible prompt; the answer is the next turn in the transcript' }
    case 'send-message': {
      if ((await permissionOf(deps, 'SendMessage', { to: target.ref, message: body })).decision === 'deny') return err('refused', 'the engine\'s permission check refused SendMessage: nothing was sent')

      const outcome = await callTool(deps, { tool: 'SendMessage', to: target.ref, message: body, summary: body.slice(0, 40) })

      return outcome.ok ? { ok: true, state: 'queued', text: `${outcome.text} (queued: it reaches the agent when its current turn ends)` } : err(outcome.kind === 'denied' ? 'refused' : 'error', outcome.text)
    }
    case 'hive': {
      if (target.ref === 'propose') {
        const spec = deps.hive === null ? null : hivePropose(deps.hive, body)

        if (spec === null) return err('refused', 'a proposal is not possible now')

        const proposed = await deps.run([...deps.cli, ...spec.args], WAIT.cli).catch(() => undefined)

        return proposed !== undefined && proposed.exitCode === 0 ? { ok: true, state: 'sent', text: 'the proposal was opened; the workers vote on it' } : err('error', proposed?.stderr ?? 'refused')
      }

      return viaCli(deps, 'hive-mind_broadcast', { message: body, priority: 'normal', fromId: OPERATOR })
    }
    case 'task': {
      const note = taskNote(body)

      return note === null ? err('refused', 'no task id') : viaCli(deps, 'task_update', { taskId: note.id, result: { guidance: note.note } })
    }
    case 'bbs':
      return viaCli(deps, 'federation_bbs_publish', { roomId: target.ref, msgType: 'human-message', payload: { text: body, from: 'ruflo-console' } })
    case 'x-channel':
      return viaCli(deps, 'x_federation_channel_publish', { channel: target.ref, msgType: 'Status', payload: { text: body, from: 'ruflo-console' } })
    case 'peer': {
      const result = await deps.run(['bash', deps.helper, 'dispatch', target.ref, body, ...(deps.trustedPeers.has(target.ref) ? [] : ['--confirm'])], WAIT.peer).catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : 'refused' }))

      return result.exitCode === 0 && result.stdout.trim() !== '' ? { ok: true, state: 'reply', text: tidy(result.stdout).trim() } : err('error', result.stderr.trim() !== '' ? result.stderr : `the peer answered nothing (exit ${result.exitCode})`)
    }
    case 'codex': {
      const result = await deps.run(['codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', deps.cwd, '-'], WAIT.codex, body).catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : 'refused' }))
      const used = /tokens used\s*[:\n]\s*([\d,]+)/i.exec(result.stderr + result.stdout)?.[1]

      return result.exitCode === 0 && result.stdout.trim() !== '' ? { ok: true, state: 'reply', text: tidy(result.stdout).trim(), ...(used !== undefined && { tokensTotal: Number(used.replace(/,/g, '')) }) } : err('error', result.stderr.trim() !== '' ? result.stderr : `codex answered nothing (exit ${result.exitCode})`)
    }
    case 'http': {
      const endpoint = endpointOf(target, deps.config)

      if (endpoint === undefined) return err('refused', `no endpoint named ${target.ref}`)
      if (deps.httpSend === undefined) return err('error', 'this host cannot send an HTTP request')

      let key: string | undefined

      if (endpoint.keyEnv !== 'NONE') {
        const read = await deps.run(['printenv', endpoint.keyEnv], 5_000).catch(() => undefined)

        key = read !== undefined && read.exitCode === 0 ? read.stdout.trim() : undefined

        if (key === undefined || key === '') return err('refused', `$${endpoint.keyEnv} is not set in the environment Claude Code runs in: nothing was sent`)
      }

      const response = await deps.httpSend(`${endpoint.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key !== undefined && { authorization: `Bearer ${key}` }) }, body: chatBody(endpoint, body) }).catch((error: unknown) => ({ ok: false, status: 0, text: error instanceof Error ? error.message : 'refused' }))

      return response.ok ? parseChat(response.text, key) : err('error', `${response.status === 0 ? 'the request failed' : `HTTP ${response.status}`}: ${scrub(response.text, key).slice(0, 160)}`)
    }
  }
}
