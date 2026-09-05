/**
 * `auth.json` persistence — atomic tmp+rename, 0600, under ~/.ruflo (ADR-306).
 * Reuses the exact same primitives `proxy-config.toml`'s consent mirror and
 * every other funnel state file already use (src/funnel/state.ts).
 */

import { readStateJson, writeStateJson, deleteStateFile } from '../funnel/state.js';
import type { AuthFile, ProfileAuthState } from './types.js';

const AUTH_FILE = 'auth.json';
export const DEFAULT_PROFILE = 'default';

function emptyAuthFile(): AuthFile {
  return { schemaVersion: 1, defaultProfile: DEFAULT_PROFILE, profiles: {} };
}

export function readAuthFile(): AuthFile {
  const file = readStateJson<AuthFile>(AUTH_FILE);
  return file ?? emptyAuthFile();
}

function writeAuthFile(file: AuthFile): void {
  writeStateJson(AUTH_FILE, file);
}

export function getProfile(name?: string): ProfileAuthState | null {
  const file = readAuthFile();
  const key = name ?? file.defaultProfile;
  return file.profiles[key] ?? null;
}

export function listProfiles(): { defaultProfile: string; profiles: ProfileAuthState[] } {
  const file = readAuthFile();
  return { defaultProfile: file.defaultProfile, profiles: Object.values(file.profiles) };
}

/** Writes/overwrites a profile. The first profile ever written becomes the default. */
export function setProfile(name: string, state: ProfileAuthState, makeDefault = false): void {
  const file = readAuthFile();
  const isFirst = Object.keys(file.profiles).length === 0;
  file.profiles[name] = state;
  if (makeDefault || isFirst) file.defaultProfile = name;
  writeAuthFile(file);
}

export function removeProfile(name: string): boolean {
  const file = readAuthFile();
  if (!(name in file.profiles)) return false;
  delete file.profiles[name];
  if (file.defaultProfile === name) {
    const remaining = Object.keys(file.profiles);
    file.defaultProfile = remaining[0] ?? DEFAULT_PROFILE;
  }
  writeAuthFile(file);
  return true;
}

/** `auth logout --all` — forgets every profile. */
export function clearAllProfiles(): void {
  deleteStateFile(AUTH_FILE);
}
