#!/usr/bin/env node
// A stand-in for the pinned Codex (ADR-489 phase 3 tests): `--version` says the pinned version; `exec --json ... -` reads the prompt on stdin
// and streams the events the real CLI writes (thread.started, an agent message, turn.completed). What it was started with goes to the file
// `fake-codex.log` in CODEX_HOME (the one variable besides PATH and HOME the host lets a child see), so a test can assert the exact argv, that
// the prompt came on stdin, and what the child's environment held.
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)

if (args[0] === '--version') {
  console.log('codex-cli 0.162.0')
  process.exit(0)
}

let input = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => (input += chunk))
process.stdin.on('end', () => {
  if (process.env.CODEX_HOME) appendFileSync(`${process.env.CODEX_HOME}/fake-codex.log`, JSON.stringify({ args, input, codexHome: process.env.CODEX_HOME, hasOpenRouterKey: process.env.OPENROUTER_API_KEY !== undefined, hasOtherSecret: process.env.SOME_OTHER_SECRET !== undefined }) + '\n')

  const event = e => console.log(JSON.stringify(e))

  event({ type: 'thread.started', thread_id: '019f0000-aaaa-bbbb-cccc-000000000001' })
  event({ type: 'item.completed', item: { type: 'agent_message', text: `echo: ${input.trim()}\n\u001b]0;pwned\u0007and a second line` } })
  event({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 7 } })
})
