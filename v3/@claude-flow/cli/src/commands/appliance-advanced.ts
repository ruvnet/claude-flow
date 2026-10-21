/**
 * V3 CLI Appliance Advanced Commands (Phase 3-4)
 * Sign, publish, and hot-patch RVFA appliances.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const fail = (msg: string, detail?: string): CommandResult => {
  output.printError(msg, detail);
  return { success: false, exitCode: 1 };
};

function hdr(title: string): void {
  output.writeln();
  output.writeln(output.bold(title));
  output.writeln(output.dim('─'.repeat(50)));
  output.writeln();
}

async function requireFile(file: string): Promise<boolean> {
  const fs = await import('fs');
  if (!fs.existsSync(file)) {
    output.printError(`File not found: ${file}`);
    return false;
  }
  return true;
}

// SIGN
export const signCommand: Command = {
  name: 'sign',
  description: 'Sign an RVFA appliance with Ed25519 for tamper detection',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'key', short: 'k', type: 'string', description: 'Path to Ed25519 private key (PEM)' },
    { name: 'generate-keys', type: 'boolean', description: 'Generate a new key pair' },
    { name: 'key-dir', type: 'string', description: 'Directory for key storage', default: '.rvfa-keys' },
    { name: 'signer', type: 'string', description: 'Publisher name for signature metadata' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    const keyPath = ctx.flags.key as string | undefined;
    const genKeys = ctx.flags.generateKeys as boolean;
    const keyDir = ctx.flags.keyDir as string || '.rvfa-keys';
    const signer = ctx.flags.signer as string | undefined;
    if (!file) return fail('--file is required');

    try {
      const signing = await import('../appliance/rvfa-signing.js');

      if (genKeys) {
        hdr('Generating Ed25519 Key Pair');
        const kp = await signing.generateKeyPair();
        const paths = await signing.saveKeyPair(kp, keyDir);
        output.printSuccess(`Public key:  ${paths.publicKeyPath}`);
        output.printSuccess(`Private key: ${paths.privateKeyPath}`);
        output.printInfo(`Fingerprint: ${kp.fingerprint}`);
        output.writeln(output.dim('  Keep the private key secure. Share only the public key.'));
        output.writeln();
      }

      if (!(await requireFile(file))) return { success: false, exitCode: 1 };
      hdr('Signing RVFA Appliance');

      let privateKey: Buffer;
      if (keyPath) {
        const fs = await import('fs');
        privateKey = fs.readFileSync(keyPath);
      } else {
        const kp = await signing.loadKeyPair(keyDir);
        privateKey = kp.privateKey;
      }

      const s = new signing.RvfaSigner(privateKey);
      const meta = await s.signAppliance(file, signer);
      output.printSuccess('Appliance signed successfully');
      output.printInfo(`Algorithm:   ${meta.algorithm}`);
      output.printInfo(`Fingerprint: ${meta.publicKeyFingerprint}`);
      output.printInfo(`Signed at:   ${meta.signedAt}`);
      if (signer) output.printInfo(`Signed by:   ${signer}`);
      output.printInfo(`Signature:   ${meta.signature.slice(0, 32)}...`);
      return { success: true, data: meta };
    } catch (err) {
      return fail('Signing failed', errMsg(err));
    }
  },
};

// PUBLISH
export const publishCommand: Command = {
  name: 'publish',
  description: 'Publish an RVFA appliance to IPFS via Pinata',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'name', short: 'n', type: 'string', description: 'Publication name' },
    { name: 'description', type: 'string', description: 'Description' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    if (!file) return fail('--file is required');
    if (!(await requireFile(file))) return { success: false, exitCode: 1 };

    try {
      const dist = await import('../appliance/rvfa-distribution.js');

      hdr('Publishing RVFA to IPFS');
      output.printInfo(`File: ${file}`);
      output.writeln();

      const publisher = dist.createPublisher();
      const result = await publisher.publish(file, {
        name: ctx.flags.name as string | undefined,
        description: ctx.flags.description as string | undefined,
      });

      output.printSuccess('Published successfully');
      output.printInfo(`CID:     ${output.bold(result.cid)}`);
      output.printInfo(`Size:    ${fmtSize(result.size)}`);
      output.printInfo(`Gateway: ${result.gatewayUrl}`);
      return { success: true, data: result };
    } catch (err) {
      return fail('Publishing failed', errMsg(err));
    }
  },
};

// UPDATE (hot-patch)
export const updateAppCommand: Command = {
  name: 'update',
  description: 'Hot-patch a section in an RVFA appliance',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'Path to .rvf file', required: true },
    { name: 'section', short: 's', type: 'string', description: 'Section to patch (e.g. ruflo, models)', required: true },
    { name: 'patch', short: 'p', type: 'string', description: 'Path to .rvfp patch file' },
    { name: 'data', short: 'd', type: 'string', description: 'Path to new section data (creates patch automatically)' },
    { name: 'version', type: 'string', description: 'Patch version', default: '0.0.1' },
    { name: 'no-backup', type: 'boolean', description: 'Skip backup creation' },
    { name: 'public-key', type: 'string', description: 'Path to public key for patch verification' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string;
    const section = ctx.flags.section as string;
    const patchPath = ctx.flags.patch as string | undefined;
    const dataPath = ctx.flags.data as string | undefined;
    if (!file || !section) return fail('--file and --section are required');
    if (!patchPath && !dataPath) return fail('Provide --patch (RVFP file) or --data (raw section data)');
    if (!(await requireFile(file))) return { success: false, exitCode: 1 };

    try {
      const dist = await import('../appliance/rvfa-distribution.js');
      const { RvfaReader } = await import('../appliance/rvfa-format.js');
      const fs = await import('fs');

      hdr('RVFA Hot-Patch Update');
      output.printInfo(`Appliance: ${file}`);
      output.printInfo(`Section:   ${section}`);
      output.writeln();

      let patchBuf: Buffer;

      if (patchPath) {
        if (!(await requireFile(patchPath))) return { success: false, exitCode: 1 };
        patchBuf = fs.readFileSync(patchPath);
        output.printInfo(`Patch file: ${patchPath} (${fmtSize(patchBuf.length)})`);
      } else {
        if (!(await requireFile(dataPath!))) return { success: false, exitCode: 1 };
        const newData = fs.readFileSync(dataPath!);
        const reader = await RvfaReader.fromFile(file);
        const appHdr = reader.getHeader();
        output.printInfo(`Creating patch for section "${section}" (${fmtSize(newData.length)} new data)`);
        patchBuf = await dist.RvfaPatcher.createPatch({
          targetName: appHdr.name,
          targetVersion: appHdr.appVersion,
          sectionId: section,
          sectionData: newData,
          patchVersion: ctx.flags.version as string || '0.0.1',
          compression: 'gzip',
        });
      }

      let pubKey: Buffer | undefined;
      if (ctx.flags.publicKey) {
        const pkPath = ctx.flags.publicKey as string;
        if (!(await requireFile(pkPath))) return { success: false, exitCode: 1 };
        pubKey = fs.readFileSync(pkPath);
      }

      const result = await dist.RvfaPatcher.applyPatch(file, patchBuf, {
        backup: ctx.flags.backup !== false,
        verify: true,
        publicKey: pubKey,
      });

      if (result.success) {
        output.printSuccess(`Section "${result.patchedSection}" updated successfully`);
        output.printInfo(`New size: ${fmtSize(result.newSize)}`);
        if (result.backupPath) output.printInfo(`Backup:  ${result.backupPath}`);
      } else {
        output.printError('Patch failed');
        result.errors.forEach(e => output.writeln(`  ${output.error('X')} ${e}`));
      }
      return { success: result.success, exitCode: result.success ? 0 : 1, data: result };
    } catch (err) {
      return fail('Update failed', errMsg(err));
    }
  },
};
