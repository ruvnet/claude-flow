// Check entry-point arguments before tool resolution, file writes, or benchmarks.
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Options map flags to a value label, or null for a boolean switch. */
export function guardCliArgs(scriptUrl, options, note = '') {
  const args = process.argv.slice(2);
  const usage = [
    `Usage: node scripts/${basename(fileURLToPath(scriptUrl))} [options]`,
    ...(note ? ['', note] : []),
    '',
    'Options:',
    ...Object.entries(options).map(([flag, value]) => `  ${flag}${value ? ` <${value}>` : ''}`),
    '  --help, -h  Show this help without running the command',
  ].join('\n');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    let error;
    if (!Object.hasOwn(options, flag)) {
      error = `Unknown argument: ${flag}`;
    } else if (options[flag] !== null) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) {
        error = `${flag} requires a value`;
      }
    }
    if (error) {
      console.error(`${error}\n\n${usage}`);
      process.exit(2);
    }
  }
}
