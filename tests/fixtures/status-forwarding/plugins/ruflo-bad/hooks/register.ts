// Deliberately bad fixture for check-status-forwarding: forwards a neighbour's status file into prompt context.
export async function onPrompt($: any) {
  const raw = await $.fs.read('.claude-flow/agentdb-mod/status.json')
  return { context: [raw] }
}
