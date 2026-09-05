import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  canonicalJson,
  captureRepositorySourceState,
  type ExactSourceState,
} from './repository-state.js';
import { portableCaseFold } from './portable-case-fold.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface DeclaredBuildInput {
  name: string;
  /** Repository-relative declaration; it may name an ignored generated input. */
  path: string;
  digest: string;
  bytes: number;
}

export interface DeclaredToolchain {
  name: string;
  version: string;
  /** Digest of the executable, image, lock, or immutable toolchain manifest. */
  digest: string;
}

export interface BuildInputDeclaration {
  name: string;
  path: string;
}

export interface ToolchainDeclaration {
  name: string;
  version: string;
  /** Local executable or immutable manifest to hash; not embedded in evidence. */
  path: string;
}

export interface BuildEvidence {
  contractVersion: 1;
  assurance: 'declared-unsigned';
  sourceStateId: string;
  buildInputs: readonly DeclaredBuildInput[];
  toolchains: readonly DeclaredToolchain[];
  evidenceDigest: string;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} must be non-empty`);
  return result;
}

function requireDigest(value: string, label: string): string {
  if (!DIGEST.test(value)) throw new Error(`${label} must be a canonical sha256 digest`);
  return value;
}

function normalizePath(value: string): string {
  const path = requireText(value, 'build input path');
  if (
    path.includes('\\')
    || path.startsWith('/')
    || path.startsWith('-')
    || path !== path.normalize('NFC')
    || path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`unsafe build input path: ${value}`);
  }
  return path;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestPath(path: string, followSymlink: boolean): { digest: string; bytes: number } {
  const resolved = followSymlink ? realpathSync(path) : path;
  const stat = lstatSync(resolved);
  const content = stat.isSymbolicLink()
    ? Buffer.from(readlinkSync(resolved), 'utf8')
    : stat.isFile()
      ? readFileSync(resolved)
      : undefined;
  if (!content) throw new Error(`build evidence path is not a file or symlink: ${path}`);
  return {
    digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    bytes: content.byteLength,
  };
}

/**
 * Bind explicitly declared non-Git inputs and toolchains to one Git-visible
 * source state. This does not claim completeness; policy decides which
 * declarations are required for a release profile.
 */
export function createBuildEvidence(
  sourceState: ExactSourceState,
  buildInputs: readonly DeclaredBuildInput[],
  toolchains: readonly DeclaredToolchain[],
): BuildEvidence {
  const inputs = buildInputs.map((input) => ({
    name: requireText(input.name, 'build input name'),
    path: normalizePath(input.path),
    digest: requireDigest(input.digest, 'build input digest'),
    bytes: input.bytes,
  })).sort((left, right) => compare(left.path, right.path) || compare(left.name, right.name));
  const tools = toolchains.map((toolchain) => ({
    name: requireText(toolchain.name, 'toolchain name'),
    version: requireText(toolchain.version, 'toolchain version'),
    digest: requireDigest(toolchain.digest, 'toolchain digest'),
  })).sort((left, right) => compare(left.name, right.name) || compare(left.version, right.version));

  if (inputs.some(({ bytes }) => !Number.isSafeInteger(bytes) || bytes < 0)) {
    throw new Error('build input bytes must be a non-negative safe integer');
  }
  const inputKeys = inputs.map(({ name, path }) => `${name}\0${path}`);
  if (new Set(inputKeys).size !== inputKeys.length) throw new Error('duplicate declared build input');
  const foldedPaths = inputs.map(({ path }) => portableCaseFold(path));
  if (new Set(foldedPaths).size !== foldedPaths.length) {
    throw new Error('case-fold collision in declared build inputs');
  }
  const toolKeys = tools.map(({ name, version }) => `${name}\0${version}`);
  if (new Set(toolKeys).size !== toolKeys.length) throw new Error('duplicate declared toolchain');

  const body = {
    contractVersion: 1 as const,
    assurance: 'declared-unsigned' as const,
    sourceStateId: requireDigest(sourceState.sourceStateId, 'source state id'),
    buildInputs: inputs,
    toolchains: tools,
  };
  return { ...body, evidenceDigest: sha256(canonicalJson(body)) };
}

/**
 * Recompute declared evidence from local bytes. It does not prove the
 * declaration set is complete and does not sign or authorize a release.
 */
export function captureBuildEvidence(
  repoPath: string,
  sourceState: ExactSourceState,
  buildInputs: readonly BuildInputDeclaration[],
  toolchains: readonly ToolchainDeclaration[],
): BuildEvidence {
  const repoRoot = realpathSync(resolve(repoPath));
  if (captureRepositorySourceState(repoRoot).sourceStateId !== sourceState.sourceStateId) {
    throw new Error('Git-visible source state does not match the build evidence request');
  }
  const inputs = buildInputs.map((declaration): DeclaredBuildInput => {
    const path = normalizePath(declaration.path);
    const absolute = resolve(repoRoot, path);
    const real = realpathSync(absolute);
    const rel = relative(repoRoot, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`build input escapes repository: ${path}`);
    }
    return { name: declaration.name, path, ...digestPath(real, true) };
  });
  const tools = toolchains.map((declaration): DeclaredToolchain => ({
    name: declaration.name,
    version: declaration.version,
    digest: digestPath(
      isAbsolute(declaration.path) ? declaration.path : resolve(repoRoot, declaration.path),
      true,
    ).digest,
  }));
  return createBuildEvidence(sourceState, inputs, tools);
}

export function recomputeBuildEvidence(
  repoPath: string,
  expected: BuildEvidence,
  toolchains: readonly ToolchainDeclaration[],
): BuildEvidence {
  const sourceState = captureRepositorySourceState(repoPath);
  if (sourceState.sourceStateId !== expected.sourceStateId) {
    throw new Error('Git-visible source state changed before build evidence recomputation');
  }
  return captureBuildEvidence(
    repoPath,
    sourceState,
    expected.buildInputs.map(({ name, path }) => ({ name, path })),
    toolchains,
  );
}

export function buildEvidenceMatches(expected: BuildEvidence, actual: BuildEvidence): boolean {
  return expected.evidenceDigest === actual.evidenceDigest
    && expected.sourceStateId === actual.sourceStateId;
}
