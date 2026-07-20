/**
 * proxy/release.ts — pure, offline tests for target-triple detection and
 * asset-filename construction. Matches the 5 triples and the exact
 * `meta-proxy-<version>-<triple>.<ext>` naming confirmed against the real
 * v0.1.0 GitHub release during planning.
 */

import { describe, it, expect } from 'vitest';
import {
  detectTargetTriple,
  releaseAssetFilename,
  releaseArchiveExtension,
  UnsupportedPlatformError,
  TARGET_TRIPLES,
} from '../src/proxy/release.js';

describe('detectTargetTriple', () => {
  it('maps darwin/arm64 to aarch64-apple-darwin', () => {
    expect(detectTargetTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
  });

  it('maps darwin/x64 to x86_64-apple-darwin', () => {
    expect(detectTargetTriple('darwin', 'x64')).toBe('x86_64-apple-darwin');
  });

  it('maps linux/arm64 to aarch64-unknown-linux-gnu', () => {
    expect(detectTargetTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-gnu');
  });

  it('maps linux/x64 to x86_64-unknown-linux-gnu', () => {
    expect(detectTargetTriple('linux', 'x64')).toBe('x86_64-unknown-linux-gnu');
  });

  it('maps win32/x64 to x86_64-pc-windows-msvc', () => {
    expect(detectTargetTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
  });

  it('throws UnsupportedPlatformError for win32/arm64 — meta-proxy publishes no such triple', () => {
    expect(() => detectTargetTriple('win32', 'arm64')).toThrow(UnsupportedPlatformError);
  });

  it('throws UnsupportedPlatformError for an unrecognized platform', () => {
    expect(() => detectTargetTriple('freebsd', 'x64')).toThrow(UnsupportedPlatformError);
  });
});

describe('releaseArchiveExtension', () => {
  it('is zip for the windows triple', () => {
    expect(releaseArchiveExtension('x86_64-pc-windows-msvc')).toBe('zip');
  });

  it('is tar.gz for every other triple', () => {
    for (const triple of TARGET_TRIPLES) {
      if (triple === 'x86_64-pc-windows-msvc') continue;
      expect(releaseArchiveExtension(triple)).toBe('tar.gz');
    }
  });
});

describe('releaseAssetFilename', () => {
  it('matches the exact real asset name confirmed against v0.1.0', () => {
    expect(releaseAssetFilename('0.1.0', 'x86_64-pc-windows-msvc')).toBe('meta-proxy-0.1.0-x86_64-pc-windows-msvc.zip');
    expect(releaseAssetFilename('0.1.0', 'aarch64-apple-darwin')).toBe('meta-proxy-0.1.0-aarch64-apple-darwin.tar.gz');
  });
});
