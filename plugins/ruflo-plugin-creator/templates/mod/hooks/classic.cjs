// The classic fallback. It runs as a settings hook on every prompt; while the
// module is loaded (it sets MY_MOD_ACTIVE on the Claude Code process, which
// every hook started after inherits) it does nothing, so nothing fires twice.
'use strict';
if (process.env.MY_MOD_ACTIVE === '1') process.exit(0);
// Without function hooks: do the classic-path equivalent of the module's work
// here (this template has none to do), always exiting 0.
process.exit(0);
