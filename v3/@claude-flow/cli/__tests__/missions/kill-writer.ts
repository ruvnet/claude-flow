/**
 * Child process for the kill-and-restart test: creates a mission, then revises
 * its plan as fast as it can until the parent SIGKILLs it mid-write.
 */
import { MissionService } from '../../src/missions/index.js';
import { plan } from './helpers.js';

const root = process.argv[2];
const service = new MissionService({ projectRoot: root, channel: 'cli' });
const created = await service.create({ requestId: 'kill-create', objective: 'survive SIGKILL' });
if (!created.ok) throw new Error(created.message);
let revision = created.data.revision;
process.stdout.write(`ready ${created.data.missionId}\n`);
for (let i = 0; ; i++) {
  const body = plan({ budget: { currency: 'USD', ceilingMinor: 1_000 + i } });
  const r = await service.plan({ requestId: `kill-plan-${i}`, missionId: created.data.missionId, expectedRevision: revision, plan: body });
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  revision = r.data.revision;
}
