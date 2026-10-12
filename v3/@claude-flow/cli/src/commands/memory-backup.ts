/**
 * V3 CLI `memory backup` command.
 *
 * WAL-safe snapshots of the active CLI and AgentDB stores with rotation
 * and optional GCS offsite. Thin surface over ../services/memory-backup.js; the
 * daemon's nightly `backup` worker calls the same service.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { backupMemoryDb, backupProjectMemoryDbs, type BackupResult } from '../services/memory-backup.js';

export const backupCommand: Command = {
  name: 'backup',
  description: 'Snapshot active project memory stores — WAL-safe, rotated, optional GCS offsite',
  options: [
    { name: 'db', description: 'Source DB (default: configured CLI and AgentDB stores)', type: 'string' },
    { name: 'dir', description: 'Destination dir (default: .swarm/backups)', type: 'string' },
    { name: 'keep', description: 'Rotation — keep the newest N snapshots (default 7)', type: 'number', default: 7 },
    { name: 'gcs', description: 'Also upload the snapshot to a gs://bucket/prefix (offsite)', type: 'string' },
    { name: 'verbose', short: 'v', description: 'Verbose logging', type: 'boolean' },
  ],
  examples: [
    { command: 'claude-flow memory backup', description: 'Snapshot active project stores, keep last 7' },
    { command: 'claude-flow memory backup --keep 30', description: 'Keep a month of nightly snapshots' },
    { command: 'claude-flow memory backup --gcs gs://my-bucket/ruflo-backups', description: 'Also upload offsite to GCS' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const options = {
      destDir: ctx.flags.dir as string | undefined,
      keep: typeof ctx.flags.keep === 'number' ? (ctx.flags.keep as number) : 7,
      gcs: ctx.flags.gcs as string | undefined,
      verbose: ctx.flags.verbose === true,
    };
    const explicitDb = ctx.flags.db as string | undefined;
    let r: BackupResult;
    let receipts: BackupResult[];
    if (explicitDb) {
      r = await backupMemoryDb({ ...options, dbPath: explicitDb });
      receipts = [r];
    } else {
      const project = await backupProjectMemoryDbs(ctx.cwd, options);
      r = project;
      receipts = project.backups;
    }

    if (!r.backedUp) {
      // no-db is a benign "nothing to back up yet"; anything else is a real skip.
      if (r.skipped === 'no-db') {
        output.printWarning('No memory DB found to back up. Nothing to do.');
        return { success: true, data: r };
      }
      output.printError(`Backup skipped: ${r.skipped}`);
      return { success: false, exitCode: 1, data: r };
    }

    output.writeln();
    for (const receipt of receipts) {
      if (receipt.backedUp) output.writeln(output.success(`Backed up → ${receipt.path}`));
    }
    output.printList([
      `Size:      ${Math.round((r.sizeBytes ?? 0) / 1024)} KB`,
      `Rotated:   ${r.rotatedAway?.length ?? 0} old snapshot(s) removed`,
      ...(r.gcsUri ? [`Offsite:   ${r.gcsUri}`] : []),
    ]);
    return { success: true, data: r };
  },
};

export default backupCommand;
