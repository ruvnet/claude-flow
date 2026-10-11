/** In-process fake dashboard for connector tests: device pairing HTTP endpoints + the /connect WebSocket. Loopback only. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { generateKeyPair, randomToken, ReplayGuard, signEnvelope, verifyEnvelope, type Envelope, type KeyPair } from '../../../src/dashboard/protocol/index.js';

export interface FakeServerOpts { slowDownOnce?: boolean; pairingResult?: 'approve' | 'deny' | 'expire' | 'never'; denyConnect?: boolean }

export class FakeDashboard {
  server!: Server; wss!: WebSocketServer;
  serverKeys: KeyPair = generateKeyPair();
  deviceId = 'dev_' + randomToken(18); tenantId = 'tnt_' + randomToken(18);
  devicePublicKey = '';
  deviceCode = randomToken(24);
  codeRequests: Record<string, unknown>[] = [];
  tokenPolls = 0; private slowed = false;
  received: Envelope[] = []; rejected: string[] = [];
  sockets = new Set<WebSocket>();
  private seq = Date.now() * 1000;
  private guard = new ReplayGuard();
  port = 0;
  constructor(public opts: FakeServerOpts = {}) {}

  get baseUrl(): string { return `http://127.0.0.1:${this.port}`; }
  get connectUrl(): string { return `ws://127.0.0.1:${this.port}/connect`; }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* empty */ }
        const send = (status: number, j: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
        if (req.method === 'POST' && req.url === '/api/device/code') {
          this.codeRequests.push(body); this.devicePublicKey = String(body.publicKey);
          return send(200, { deviceCode: this.deviceCode, userCode: 'ABCD2345', verificationUri: `${this.baseUrl}/link`, expiresIn: 600, interval: 1 });
        }
        if (req.method === 'POST' && req.url === '/api/device/token') {
          this.tokenPolls++;
          if (body.deviceCode !== this.deviceCode) return send(400, { error: 'invalid_code' });
          if (this.opts.slowDownOnce && !this.slowed) { this.slowed = true; return send(429, { status: 'slow_down' }); }
          const r = this.opts.pairingResult ?? 'approve';
          if (r === 'never' || this.tokenPolls < 2) return send(200, { status: 'pending' });
          if (r === 'deny') return send(200, { status: 'denied' });
          if (r === 'expire') return send(200, { status: 'expired' });
          return send(200, { status: 'approved', deviceId: this.deviceId, tenantId: this.tenantId, serverPublicKey: this.serverKeys.publicKey, connectUrl: this.connectUrl });
        }
        send(404, { error: 'not_found' });
      });
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/connect', verifyClient: () => !this.opts.denyConnect });
    this.wss.on('connection', ws => {
      this.sockets.add(ws); ws.on('close', () => this.sockets.delete(ws));
      ws.on('message', data => {
        const v = verifyEnvelope(data.toString('utf8'), this.devicePublicKey, { did: this.deviceId, tid: this.tenantId }, this.guard);
        if (v.ok) this.received.push(v.env); else this.rejected.push(v.reason);
      });
    });
    await new Promise<void>(r => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  /** Sign a server->device frame. Override fields to forge: wrong key, stale ts, reused seq, wrong tenant. */
  frame(typ: 'command' | 'revoke' | 'ping', body: Record<string, unknown>, o: { key?: string; ts?: number; seq?: number; tid?: string; did?: string } = {}): string {
    return JSON.stringify(signEnvelope(o.key ?? this.serverKeys.privateKey, { typ, did: (o.did ?? this.deviceId) as `dev_${string}`, tid: (o.tid ?? this.tenantId) as `tnt_${string}`, seq: o.seq ?? ++this.seq, body, ...(o.ts ? { ts: o.ts } : {}) }));
  }
  command(cmd: string, args: Record<string, unknown> = {}, o: { expiresAt?: number; by?: string; cid?: string } & Parameters<FakeDashboard['frame']>[2] = {}): string {
    const { expiresAt, by, cid, ...rest } = o;
    return this.frame('command', { cid: cid ?? 'cmd_' + randomToken(16), cmd, args, by: by ?? 'user-hash', expiresAt: expiresAt ?? Date.now() + 60_000 }, rest);
  }
  broadcast(frame: string): void { for (const s of this.sockets) s.send(frame); }
  async waitFor<T>(pred: () => T | undefined | false, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) { const r = pred(); if (r) return r; if (Date.now() > end) throw new Error('waitFor timed out'); await new Promise(r => setTimeout(r, 20)); }
  }
  byTyp(typ: string): Envelope[] { return this.received.filter(e => e.typ === typ); }
  async stop(): Promise<void> {
    for (const s of this.sockets) s.terminate();
    await new Promise<void>(r => this.wss.close(() => r()));
    await new Promise<void>(r => { this.server.close(() => r()); this.server.closeAllConnections?.(); });
  }
}
