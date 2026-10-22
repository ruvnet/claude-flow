/**
 * The one file the merge owner edits to switch a Workflows slot on (ADR-464): each feature that registers slots
 * (views/wf-slots.ts) is imported here for its side effect, one line apiece. The seams that need the state or the host
 * (read-after hooks, the export filesystem, the drill's reader) are bound once in hooks/wf-wire.ts.
 *
 * The order matters for hotkeys only: worktrees and templates name the keys w, t, c and g and have no fallback, while the drill's
 * keys each carry a list of letters and take the first one free (views/wf-detail.ts KEYS), so the drill is imported after them.
 * tests/wf-merge.spec.ts holds the outcome.
 */
import './wf-worktrees'
import './wf-templates'
import './wf-anatole'
import '../wf-drill'
import './wf-guide'
import './wf-replay'
import './wf-triage'
import './wf-control'
import './wf-convo'
import './ap-panel'
