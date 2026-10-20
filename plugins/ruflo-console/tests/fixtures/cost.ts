/** Claude's local configure help, and synthetic routing counts shaped by ModelRouter.getStats(). */
export const CONFIGURE_HELP = 'Usage: claude plugin configure [options] <plugin>\n--values-stdin Read option values from stdin as a JSON object of single-line strings; options left out keep their values'
export const MODEL_STATS = JSON.stringify({ available: true, totalDecisions: 8, modelDistribution: { haiku: 5, sonnet: 3, opus: 0, inherit: 0 }, routedByCounts: { neural: 0, heuristic: 0 }, timestamp: '2026-10-02T12:00:00.000Z' })
