import type { RouteResult } from './route-task'

/**
 * The routing block as hook-handler.cjs `route` prints it, so the model reads
 * the same context whichever path produced it.
 *
 * @param prompt the prompt routed
 * @param result its route
 */
export function formatRoute(prompt: string, result: RouteResult): string {
  // The structured result says `no-match-default` (#3567); the box keeps the
  // classic wording, so the text the model reads is the same on both paths.
  const reason = result.matched ? result.reason : 'Default routing - no specific keyword matched'
  const row = (text: string) => `| ${text.substring(0, 60).padEnd(60)} |`
  return [
    `[INFO] Routing task: ${prompt.substring(0, 80) || '(no prompt)'}`,
    '',
    '+------------------- Primary Recommendation -------------------+',
    row(`Agent: ${result.agent}`),
    row(`Confidence: ${(result.confidence * 100).toFixed(1)}%`),
    row(`Reason: ${reason}`),
    '+--------------------------------------------------------------+',
  ].join('\n')
}
