import { describe, expect, it } from 'vitest';
import { browserCommand } from '../src/oauth/browser.js';

describe('OAuth browser launcher', () => {
  it('preserves the complete OAuth query string on Windows without cmd.exe', () => {
    const url = 'https://auth.cognitum.one/oauth/authorize?response_type=code&client_id=meta-proxy&state=test';
    const launch = browserCommand(url, 'win32');

    expect(launch.cmd).toBe('rundll32.exe');
    expect(launch.args).toEqual(['url.dll,FileProtocolHandler', url]);
    expect(launch.args[1]).toContain('&client_id=meta-proxy&');
  });
});
