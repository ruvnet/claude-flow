/**
 * `ruflo funnel` — user control surface for the Cognitum lifecycle funnel
 * (ADR-301/305/309).
 *
 *   funnel status    effective state and which precedence source decided it
 *   funnel disable   user-level opt-out (all surfaces) + delete funnel data
 *   funnel enable    re-enable at the user tier (cannot override env/enterprise)
 *   funnel accept    acknowledge the disclosure so rotation starts immediately
 *   funnel open      open the currently-shown promo URL in the default browser
 *   funnel id        print the pseudonymous funnel ID, if one exists
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  deleteFunnelData,
  funnelStateDir,
  getDisclosure,
  getFunnelId,
  promoEligible,
  readConsents,
  recordDisclosureAccepted,
  recordDisclosureDeclined,
  recordDisclosureReenabled,
  resolveFunnelEnabled,
} from '../funnel/index.js';
import { readStateJson, writeStateJson } from '../funnel/state.js';

function setUserConfigEnabled(enabled: boolean): void {
  const cfg = readStateJson<Record<string, unknown>>('funnel.json') ?? {};
  cfg.enabled = enabled;
  writeStateJson('funnel.json', cfg);
}

const statusSub: Command = {
  name: 'status',
  description: 'Show effective funnel state and which source decided it',
  options: [
    { name: 'json', description: 'Output as JSON', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const decision = resolveFunnelEnabled();
    const disclosure = getDisclosure();
    const consents = readConsents();
    const data = {
      enabled: decision.enabled,
      decidedBy: decision.decidedBy,
      disclosure: disclosure.state,
      stateDir: funnelStateDir(),
      consents,
    };
    if (ctx.flags.json) {
      output.printJson(data);
    } else {
      output.writeln(`Funnel: ${decision.enabled ? 'enabled' : 'disabled'} (decided by: ${decision.decidedBy})`);
      output.writeln(`Disclosure: ${disclosure.state}`);
      output.writeln(`State dir: ${funnelStateDir()}`);
      const domains = Object.keys(consents);
      output.writeln(
        domains.length
          ? `Consents: ${domains.map((d) => `${d}=${(consents as Record<string, { granted?: boolean }>)[d]?.granted ? 'granted' : 'declined'}`).join(', ')}`
          : 'Consents: none recorded'
      );
    }
    return { success: true, data };
  },
};

const disableSub: Command = {
  name: 'disable',
  description: 'Disable all funnel surfaces (user-level, persists across projects)',
  action: async (): Promise<CommandResult> => {
    setUserConfigEnabled(false);
    recordDisclosureDeclined();
    deleteFunnelData(); // opt-out deletes the pseudonymous ID + local event queue
    output.printSuccess('Funnel disabled. All promotional surfaces are off; local funnel data deleted.');
    return { success: true };
  },
};

const enableSub: Command = {
  name: 'enable',
  description: 'Re-enable funnel surfaces at the user tier (env/enterprise disables still win)',
  action: async (): Promise<CommandResult> => {
    setUserConfigEnabled(true);
    recordDisclosureReenabled();
    const decision = resolveFunnelEnabled();
    if (decision.enabled) {
      output.printSuccess('Funnel enabled.');
    } else {
      // A lower-precedence source never overrides a higher-precedence disable.
      output.printWarning(
        `User preference recorded, but the funnel stays disabled by a higher-precedence source: ${decision.decidedBy}`
      );
    }
    return { success: true, data: decision };
  },
};

const acceptSub: Command = {
  name: 'accept',
  description: 'Acknowledge the disclosure so rotation starts immediately (skips the 24h grace window)',
  action: async (): Promise<CommandResult> => {
    const decision = resolveFunnelEnabled();
    if (!decision.enabled) {
      output.printWarning(
        `Funnel is currently disabled by: ${decision.decidedBy}. Run 'ruflo funnel enable' first, then re-run accept.`
      );
      return { success: false, data: decision };
    }
    const current = getDisclosure();
    if (current.state === 'disclosed_disabled') {
      output.printWarning(
        "Disclosure is in a declined state. Run 'ruflo funnel enable' first, then re-run accept."
      );
      return { success: false, data: current };
    }
    const rec = recordDisclosureAccepted();
    const eligible = promoEligible();
    output.printSuccess(
      `Disclosure accepted (firstShownAt backdated to ${rec.firstShownAt}). Promo rotation eligible: ${eligible}.`
    );
    return { success: true, data: { record: rec, eligible } };
  },
};

// Reads the memoized promo written by the statusline renderer. Same file
// path as .claude/helpers/statusline.cjs's PROMO_MEMO_FILE — kept in sync
// by convention. Returns null on any error so a broken memo can't crash
// the subcommand.
function readCurrentPromo(): { text: string; url?: string; kind?: string } | null {
  try {
    const memoPath = path.join(os.homedir(), '.ruflo', 'statusline-promo.json');
    const raw = JSON.parse(fs.readFileSync(memoPath, 'utf-8'));
    if (raw && raw.promo && typeof raw.promo === 'object') return raw.promo;
  } catch { /* memo absent or corrupt — treat as "nothing shown yet" */ }
  return null;
}

// Allowlist mirrors the OSC 8 hyperlink allowlist in the statusline renderer.
// Never open a URL whose host isn't on this list, even if a corrupted memo
// somehow lands one there — the memo is user-writable so we must not treat
// it as trusted. Kept in sync with .claude/helpers/statusline.cjs's
// PROMO_LINK_HOSTS.
const OPEN_ALLOWED_HOSTS = new Set([
  'cognitum.one', 'www.cognitum.one', 'docs.cognitum.one',
  'agentics.org', 'www.agentics.org',
  'funnel.ruv.io',
  'cognitum-analytics-63rzcdswba-uc.a.run.app',
]);

// Open a URL using the platform's default browser handler. execFile (not
// exec) — no shell involved, so nothing in the URL can be interpreted as a
// shell command even in the pathological case where allowlisting is
// bypassed. Runs detached + hidden so no cmd window flashes on Windows.
function openInBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const [cmd, args] = platform === 'win32'
      // "start" needs an empty title argument first, else the first quoted
      // arg becomes the title and the URL is ignored. cmd /c is required to
      // invoke the built-in start command.
      ? ['cmd', ['/c', 'start', '""', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
    execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

const openSub: Command = {
  name: 'open',
  description: 'Open the currently-shown statusline promo URL in the default browser',
  action: async (): Promise<CommandResult> => {
    const promo = readCurrentPromo();
    if (!promo) {
      output.printWarning(
        "No promo has been shown yet. Wait for the statusline to render one, then re-run 'ruflo funnel open'."
      );
      return { success: false };
    }
    if (!promo.url) {
      output.printWarning(
        `Current promo (kind=${promo.kind ?? 'unknown'}) has no URL. Nothing to open: "${promo.text}"`
      );
      return { success: false, data: promo };
    }
    let parsed: URL;
    try { parsed = new URL(promo.url); } catch {
      output.printError(`Promo URL is malformed: ${promo.url}`);
      return { success: false, data: promo };
    }
    if (parsed.protocol !== 'https:' || !OPEN_ALLOWED_HOSTS.has(parsed.hostname)) {
      output.printError(
        `Refusing to open URL — not on the allowlist: ${parsed.protocol}//${parsed.hostname}`
      );
      return { success: false, data: { url: promo.url } };
    }
    try {
      await openInBrowser(parsed.href);
      output.printSuccess(`Opened: ${parsed.href}`);
      return { success: true, data: { url: parsed.href } };
    } catch (err) {
      output.printError(`Failed to open URL: ${err instanceof Error ? err.message : String(err)}`);
      output.writeln(`URL for manual copy: ${parsed.href}`);
      return { success: false, data: { url: parsed.href } };
    }
  },
};

const idSub: Command = {
  name: 'id',
  description: 'Print the pseudonymous funnel ID (exists only with telemetry consent)',
  action: async (): Promise<CommandResult> => {
    const id = getFunnelId();
    if (id) {
      output.writeln(id);
    } else {
      output.writeln('No funnel ID (telemetry consent not granted, or funnel data deleted).');
    }
    return { success: true, data: { id } };
  },
};

export const funnelCommand: Command = {
  name: 'funnel',
  description: 'Control the Cognitum lifecycle funnel surfaces (tips, enrollment, notices)',
  subcommands: [statusSub, disableSub, enableSub, acceptSub, openSub, idSub],
  examples: [
    { command: 'ruflo funnel status', description: 'Effective state + deciding source' },
    { command: 'ruflo funnel accept', description: 'Skip the 24h grace so rotation starts now' },
    { command: 'ruflo funnel open', description: 'Open the current promo URL in the browser' },
    { command: 'ruflo funnel disable', description: 'Turn off every funnel surface' },
  ],
  action: statusSub.action,
};

export default funnelCommand;
