/**
 * #3527: `ruflo init` must not pin a Claude model in the generated .claude/settings.json.
 *
 * Claude Code's project settings outrank the user's own settings, so a pinned
 * `model` silently overrides the model the user chose (for example the `opus`
 * alias, which resolves to the newest Opus). settings-generator.ts wrote
 * `settings.model = 'claude-sonnet-5'` into every freshly initialised project,
 * and the repo's own .claude/settings.json carried the same pin, so every ruflo
 * project quietly ran an older model.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateSettings, generateSettingsJson } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

describe('ruflo init leaves the Claude model to the user', () => {
  it('generateSettings() writes no model key', () => {
    expect(generateSettings(DEFAULT_INIT_OPTIONS)).not.toHaveProperty('model');
  });

  it('the settings.json written by a fresh init or --force has no model key', () => {
    expect(JSON.parse(generateSettingsJson(DEFAULT_INIT_OPTIONS))).not.toHaveProperty('model');
  });

  it("the repo's own .claude/settings.json does not pin a model either", () => {
    const repoSettings = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../../.claude/settings.json', import.meta.url)), 'utf8'),
    );
    expect(repoSettings).not.toHaveProperty('model');
  });
});
