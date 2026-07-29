import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputFormatter } from '../../cli-core/src/output.js';

describe('#2814 spinner output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits no transient frames or clearing bytes when stdout is not a TTY', () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const spinner = new OutputFormatter({ color: false }).createSpinner({ text: 'Checking...' });
      spinner.start();
      spinner.stop();
      expect(write).not.toHaveBeenCalled();
    } finally {
      if (isTTY) Object.defineProperty(process.stdout, 'isTTY', isTTY);
    }
  });
});
