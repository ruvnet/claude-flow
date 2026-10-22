/** The bundle entry (ADR-489): what `ruflo tui` loads. Built to dist/tui.mjs by scripts/build-tui.mjs. */
export { runTui, isTuiView, isPage, keyOf, depthOf } from './run'
export type { TuiIO, TuiOptions } from './run'
export { TUI_VIEWS } from './session'
