#!/usr/bin/env node
'use strict';

// Execution fixture for test-hooks.mjs. The hook shim invokes CLI commands as
// `<cli> hooks <subcommand> ...`; surfacing that subcommand proves telemetry
// was attempted without coupling the host-protocol regression to CLI startup.
const [, , group, subcommand] = process.argv;
if (group !== 'hooks' || !subcommand) process.exit(2);
process.stdout.write(`hook-telemetry:${subcommand}`);
