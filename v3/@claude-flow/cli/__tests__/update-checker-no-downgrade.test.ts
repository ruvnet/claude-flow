/**
 * getUpdateType compared major, minor and patch independently, so a CLI AHEAD of the registry's `latest` in minor but behind it in
 * patch (3.60.0 running, latest 3.59.17) read as a 'patch' update (17 > 0) and the startup check auto-installed the older version:
 * a downgrade. An update is a strictly newer version, and only that.
 */
import { describe, expect, it } from 'vitest';
import { getUpdateType } from '../src/update/checker.js';

describe('getUpdateType', () => {
  it('never reports a version that is not newer as an update (the 3.60.0 vs 3.59.17 downgrade)', () => {
    expect(getUpdateType('3.60.0', '3.59.17')).toBe('none');
    expect(getUpdateType('3.58.0', '3.57.2')).toBe('none');
    expect(getUpdateType('4.0.0', '3.99.99')).toBe('none');
    expect(getUpdateType('3.59.17', '3.59.16')).toBe('none');
    expect(getUpdateType('3.59.17', '3.59.17')).toBe('none');
    expect(getUpdateType('3.7.0-alpha.2', '3.7.0-alpha.1')).toBe('none');
  });

  it('still names a newer version by how far ahead it is', () => {
    expect(getUpdateType('3.59.16', '3.59.17')).toBe('patch');
    expect(getUpdateType('3.59.17', '3.60.0')).toBe('minor');
    expect(getUpdateType('3.59.17', '3.60.3')).toBe('minor');
    expect(getUpdateType('3.59.17', '4.0.0')).toBe('major');
    expect(getUpdateType('3.9.9', '3.10.0')).toBe('minor');
  });

  it('reads an invalid version as no update', () => {
    expect(getUpdateType('latest', '3.59.17')).toBe('none');
    expect(getUpdateType('3.59.17', 'next')).toBe('none');
  });
});
