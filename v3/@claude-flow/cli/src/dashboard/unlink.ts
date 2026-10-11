/** Unlink: best-effort signed `revoke` to the server, then delete key + config regardless of the outcome. */
import WebSocket from 'ws';
import { ReplayGuard } from './protocol/index.js';
import { Channel } from './channel.js';
import { validateConnectUrl } from './run.js';
import { AuditLog, DeviceSeq, loadConfig, loadKey, wipeState } from './state.js';

export interface UnlinkResult { wasLinked: boolean; notified: boolean }

export async function unlink(home: string, timeoutMs = 5000): Promise<UnlinkResult> {
  let cfg, key;
  try { cfg = loadConfig(home); key = cfg ? loadKey(home) : undefined; } catch { cfg = null; }
  const audit = new AuditLog(home);
  let notified = false;
  if (cfg && key) {
    try {
      notified = await new Promise<boolean>(resolve => {
        const ws = new WebSocket(validateConnectUrl(cfg.connectUrl, cfg.baseUrl), { handshakeTimeout: timeoutMs, followRedirects: false });
        const t = setTimeout(() => { ws.terminate(); resolve(false); }, timeoutMs);
        ws.on('open', () => {
          try {
            const ch = new Channel({ cfg, privateKey: key, home, seq: new DeviceSeq(home), guard: new ReplayGuard(), audit, ruflo: { mcp: async () => ({}) }, approver: async () => false, send: f => ws.send(f), sections: { tick: async () => ({ collected: [], sent: [] }), refresh: async () => ({ sent: false }), refreshAll: async () => ({ sent: [] }), setWatch: () => undefined, notice: () => undefined } });
            ch.hello();
            ch.emit('revoke', { reason: 'unlink' });
            ws.close(1000, 'unlinked');
            clearTimeout(t); resolve(true);
          } catch { clearTimeout(t); ws.terminate(); resolve(false); }
        });
        ws.on('error', () => { clearTimeout(t); resolve(false); });
      });
    } catch { notified = false; }
  }
  audit.write('unlink', { wasLinked: !!cfg, notified });
  wipeState(home);
  return { wasLinked: !!cfg, notified };
}
