/**
 * isLoopbackBind — the exact bug class meta-proxy's own Rust
 * `is_loopback_bind` was written to fix (a naive `startsWith('127.0.0.1')`
 * check misclassifies `[::1]` as network-exposed). This TS port must not
 * repeat that mistake.
 */

import { describe, it, expect } from 'vitest';
import { isLoopbackBind } from '../src/proxy/paths.js';

describe('isLoopbackBind', () => {
  it('recognizes the whole IPv4 127.0.0.0/8 block, not just .0.0.1', () => {
    expect(isLoopbackBind('127.0.0.1:11435')).toBe(true);
    expect(isLoopbackBind('127.0.0.5:11435')).toBe(true);
    expect(isLoopbackBind('127.255.255.255:11435')).toBe(true);
  });

  it('recognizes the localhost hostname, case-insensitively', () => {
    expect(isLoopbackBind('localhost:11435')).toBe(true);
    expect(isLoopbackBind('LOCALHOST:11435')).toBe(true);
  });

  it('recognizes IPv6 loopback — the exact case a naive prefix check misclassifies', () => {
    expect(isLoopbackBind('[::1]:11435')).toBe(true);
  });

  it('recognizes IPv4-mapped IPv6 loopback', () => {
    expect(isLoopbackBind('[::ffff:127.0.0.1]:11435')).toBe(true);
  });

  it('treats all-interfaces and routable binds as NOT loopback', () => {
    expect(isLoopbackBind('0.0.0.0:11435')).toBe(false);
    expect(isLoopbackBind('[::]:11435')).toBe(false);
    expect(isLoopbackBind('192.168.1.10:11435')).toBe(false);
    expect(isLoopbackBind('example.com:11435')).toBe(false);
  });
});
