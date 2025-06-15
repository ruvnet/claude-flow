// init/index.js - Main init command export
import { initClaude } from './init-claude.js';

export async function initCommand(subArgs, flags) {
  // Convert flags to options format expected by initClaude
  const options = {
    help: flags.help || flags.h || false,
    force: flags.force || flags.f || false,
    minimal: flags.minimal || flags.m || false,
    sparc: flags.sparc || flags.s || false
  };
  
  return await initClaude(options);
}