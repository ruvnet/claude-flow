import { describe, it, expect } from 'vitest';
import { ByzantineConsensus, type ByzantineMessage } from '../src/consensus/byzantine.js';

function cluster(n: number, maxFaultyNodes?: number) {
  const bft = new ByzantineConsensus('node-0', { maxFaultyNodes });
  for (let i = 1; i < n; i++) bft.addNode(`node-${i}`);
  bft.electPrimary();
  return bft;
}
const approve = (voterId: string) => ({ voterId, approve: true, confidence: 1, timestamp: new Date() });

describe('Byzantine fault bounds and safe quorum (#3560)', () => {
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid configured fault cap %s', cap => {
    expect(() => cluster(4, cap)).toThrow('maxFaultyNodes');
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('accepts unanimous approval for n=%i', async n => {
    const bft = cluster(n);
    try {
      const proposal = await bft.propose({ decision: 'unanimous' });
      for (let i = 0; i < n; i++) await bft.vote(proposal.id, approve(`node-${i}`));
      expect(proposal.status).toBe('accepted');
      expect(bft.getMaxFaultyNodes()).toBe(Math.floor((n - 1) / 3));
    } finally { await bft.shutdown(); }
  });

  it('accepts two of three approvals with zero Byzantine faults', async () => {
    const bft = cluster(3);
    try {
      const proposal = await bft.propose({ decision: 'one-silent' });
      await bft.vote(proposal.id, approve('node-0'));
      expect(proposal.status).toBe('pending');
      await bft.vote(proposal.id, approve('node-1'));
      expect(proposal.status).toBe('accepted');
      expect(bft.canTolerate(1)).toBe(false);
    } finally { await bft.shutdown(); }
  });

  it('uses an intersecting quorum across n=1..100 and valid configured fault caps', async () => {
    for (let n = 1; n <= 100; n++) {
      const derived = Math.floor((n - 1) / 3);
      for (const cap of [undefined, 0, 1, derived + 2]) {
        const bft = cluster(n, cap);
        try {
          const f = cap === undefined ? derived : Math.min(derived, cap);
          const q = Math.floor((n + f) / 2) + 1;
          expect(bft.getMaxFaultyNodes()).toBe(f);
          expect(3 * f + 1).toBeLessThanOrEqual(n);
          expect(2 * q).toBeGreaterThanOrEqual(n + f + 1);
          expect(q).toBeLessThanOrEqual(n - f);
          const proposal = await bft.propose({ n, cap });
          for (let i = 0; i < q - 1; i++) await bft.vote(proposal.id, approve(`node-${i}`));
          if (q > 1) expect(proposal.status).toBe('pending');
          await bft.vote(proposal.id, approve(`node-${q - 1}`));
          expect(proposal.status).toBe('accepted');
        } finally { await bft.shutdown(); }
      }
    }
  });

  it.each([2, 3, 5, 6, 10])('applies the same safe threshold to prepare and commit messages for n=%i', async n => {
    const bft = cluster(n);
    const f = Math.floor((n - 1) / 3);
    const q = Math.floor((n + f) / 2) + 1;
    let pre: ByzantineMessage;
    bft.on('message.broadcast', (event: { message: ByzantineMessage }) => {
      if (event.message.type === 'pre-prepare') pre = event.message;
    });
    try {
      const proposal = await bft.propose({ decision: 'protocol-quorum' });
      const message = (type: 'prepare' | 'commit', i: number): ByzantineMessage => ({
        ...pre!, type, senderId: `node-${i}`,
      });
      // propose() self-prepares; q-2 peer prepares still cannot prepare.
      for (let i = 1; i < q - 1; i++) await bft.handlePrepare(message('prepare', i));
      expect(bft.getPreparedCount()).toBe(0);
      await bft.handlePrepare(message('prepare', q - 1));
      expect(bft.getPreparedCount()).toBe(1);
      // Completing prepare self-commits; q-2 peer commits still cannot accept.
      for (let i = 1; i < q - 1; i++) await bft.handleCommit(message('commit', i));
      expect(proposal.status).toBe('pending');
      await bft.handleCommit(message('commit', q - 1));
      expect(proposal.status).toBe('accepted');
    } finally { await bft.shutdown(); }
  });
});
