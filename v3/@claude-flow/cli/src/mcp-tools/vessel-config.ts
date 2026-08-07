/**
 * Vessel config persistence helpers.
 *
 * Thin, pure-over-config wrappers around the `ConfigFileManager` singleton.
 * Vessels are persisted at config key `providers.vessels` as a record keyed by
 * name. Every read merges the on-disk user record over the built-in baseline
 * (BUILTIN_VESSELS), and `getResolvedVessels` layers env-var overrides on top.
 *
 * Merge precedence (low → high): built-ins < user config < env.
 */

import type { ProviderManagerConfig } from '@claude-flow/providers';

import { configManager } from '../services/config-file-manager.js';
import {
  BUILTIN_VESSELS,
  mergeVessels,
  vesselsFromEnv,
  toProviderManagerConfig,
} from './vessels.js';
import type { VesselConfig } from './vessels.js';

/** Config dot-key holding the user vessel record. */
const VESSELS_KEY = 'providers.vessels';

/** Config dot-key holding the default-vessel name. */
const DEFAULT_VESSEL_KEY = 'providers.defaultVessel';

/**
 * Safely narrow an arbitrary config value to a string-keyed vessel record.
 * Returns an empty record for any non-object (missing, array, primitive) so
 * callers always get a usable map.
 */
function toVesselRecord(value: unknown): Record<string, VesselConfig> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, VesselConfig>;
  }
  return {};
}

/** Read the raw user vessel record from config (never mutates it). */
function readUserVessels(cwd: string): Record<string, VesselConfig> {
  const cfg = configManager.getConfig(cwd);
  const providers = cfg.providers;
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    return toVesselRecord((providers as Record<string, unknown>).vessels);
  }
  return {};
}

/**
 * User vessels merged over the built-in baseline. Same-named user vessels
 * override built-ins; built-ins with no user counterpart survive. Neither the
 * on-disk record nor BUILTIN_VESSELS is mutated.
 */
export function getVessels(cwd: string): Record<string, VesselConfig> {
  return mergeVessels(BUILTIN_VESSELS, readUserVessels(cwd));
}

/**
 * Fully resolved vessels: built-ins < user config < env. Env-var overrides
 * (vesselsFromEnv) take precedence over both, so a configured ANTHROPIC_BASE_URL
 * wins over the anthropic built-in and any user `anthropic` entry.
 */
export function getResolvedVessels(cwd: string): Record<string, VesselConfig> {
  return mergeVessels(getVessels(cwd), vesselsFromEnv());
}

/**
 * Persist a single vessel, replacing any existing entry with the same name.
 * Writes the entire `providers.vessels` record atomically via the
 * ConfigFileManager singleton.
 */
export function setVessel(cwd: string, vessel: VesselConfig): void {
  const user = readUserVessels(cwd);
  const updated: Record<string, VesselConfig> = { ...user, [vessel.name]: vessel };
  configManager.set(cwd, VESSELS_KEY, updated);
}

/**
 * Remove a user vessel by name. Built-in vessels are never stored in the user
 * record, so they cannot be removed this way — calling with a built-in name is
 * a no-op. Writes the updated record atomically.
 */
export function removeVessel(cwd: string, name: string): void {
  const user = readUserVessels(cwd);
  if (!(name in user)) return;
  const { [name]: _removed, ...rest } = user;
  const updated: Record<string, VesselConfig> = { ...rest };
  configManager.set(cwd, VESSELS_KEY, updated);
}

/** Read the configured default-vessel name, if any. */
function readDefaultVessel(cwd: string): string | undefined {
  const cfg = configManager.getConfig(cwd);
  const providers = cfg.providers;
  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    const value = (providers as Record<string, unknown>).defaultVessel;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Compose the resolved vessel record for a cwd into a ProviderManagerConfig.
 * The optional default vessel name pins the primary provider; when omitted it
 * falls back to `providers.defaultVessel` from config, else the first vessel.
 */
export function toProviderManagerConfigForCwd(
  cwd: string,
  defaultVesselName?: string,
): ProviderManagerConfig {
  const vessels = Object.values(getResolvedVessels(cwd));
  const defaultVessel = defaultVesselName ?? readDefaultVessel(cwd);
  return toProviderManagerConfig(vessels, defaultVessel);
}

/** Bundle of vessel persistence helpers (convenience re-export surface). */
export const vesselConfigTools = {
  getVessels,
  getResolvedVessels,
  setVessel,
  removeVessel,
  toProviderManagerConfigForCwd,
};
