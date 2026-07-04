/**
 * V3 CLI `memory backup` command.
 *
 * WAL-safe snapshot of the vector-memory DB (`.swarm/memory.db`) with rotation
 * and optional GCS offsite. Thin surface over ../services/memory-backup.js; the
 * daemon's nightly `backup` worker calls the same service.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { backupMemoryDb, defaultMemoryDbPath } from '../services/memory-backup.js';

export const backupCommand: Command = {
  name: 'backup',
  description: 'Snapshot the vector-memory DB (.swarm/memory.db) — WAL-safe, rotated, optional GCS offsite',
  options: [
    { name: 'db', description: 'Source DB (default: .swarm/memory.db)', type: 'string' },
    { name: 'dir', description: 'Destination dir (default: .swarm/backups)', type: 'string' },
    { name: 'keep', description: 'Rotation — keep the newest N snapshots (default 7)', type: 'number', default: 7 },
    { name: 'gcs', description: 'Also upload the snapshot to a gs://bucket/prefix (offsite)', type: 'string' },
    { name: 'verbose', short: 'v', description: 'Verbose logging', type: 'boolean' },
  ],
  examples: [
    { command: 'claude-flow memory backup', description: 'Snapshot to .swarm/backups, keep last 7' },
    { command: 'claude-flow memory backup --keep 30', description: 'Keep a month of nightly snapshots' },
    { command: 'claude-flow memory backup --gcs gs://my-bucket/ruflo-backups', description: 'Also upload offsite to GCS' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const r = await backupMemoryDb({
      dbPath: (ctx.flags.db as string) || defaultMemoryDbPath(ctx.cwd),
      destDir: ctx.flags.dir as string | undefined,
      keep: typeof ctx.flags.keep === 'number' ? (ctx.flags.keep as number) : 7,
      gcs: ctx.flags.gcs as string | undefined,
      verbose: ctx.flags.verbose === true,
    });

    if (!r.backedUp) {
      // no-db is a benign "nothing to back up yet"; anything else is a real skip.
      if (r.skipped === 'no-db') {
        output.printWarning('No memory DB found to back up (.swarm/memory.db). Nothing to do.');
        return { success: true, data: r };
      }
      output.printError(`Backup skipped: ${r.skipped}`);
      return { success: false, exitCode: 1, data: r };
    }

    output.writeln();
    output.writeln(output.success(`Backed up → ${r.path}`));
    output.printList([
      `Size:      ${Math.round((r.sizeBytes ?? 0) / 1024)} KB`,
      `Rotated:   ${r.rotatedAway?.length ?? 0} old snapshot(s) removed`,
      ...(r.gcsUri ? [`Offsite:   ${r.gcsUri}`] : []),
    ]);
    return { success: true, data: r };
  },
};

export default backupCommand;
