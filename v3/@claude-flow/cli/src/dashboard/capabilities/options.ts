/**
 * Which plugin options the dashboard may change. This is an ALLOWLIST owned by the connector, keyed by `<plugin>.<key>`; anything not listed is `not-settable`.
 * A manifest cannot make an option settable: a plugin's own type/choices only have to agree with the rule. Safety options (guards, confirmations, modes) move
 * only toward the safer value; budget caps only go down. docs/threat-model.md lists the table.
 */
import type { CatalogOption, RefuseCode } from './types.js';

const SECRETISH = /key|token|secret|password|passwd|credential|auth|cookie|bearer|private/i;

export type OptionRule =
  /** A boolean or an enum with no safety meaning (colour, look, refresh rate). */
  | { t: 'free' }
  /** A number inside a range, both directions (refresh rate, fps). */
  | { t: 'range'; min: number; max: number }
  /** A boolean/enum safety option that may only move toward `safe`: for booleans `to` is the safer value; for enums the list is ordered least to most safe and only a higher rank is allowed. */
  | { t: 'toward'; to?: boolean; order?: readonly string[]; only?: string };
/** Budget caps: lower only (0 means "no cap": going to 0, or above a cap that is set, loosens it). */
export interface CapRule { t: 'cap'; min: number; max: number }
export type AnyRule = OptionRule | CapRule;

const GUARD_ORDER = ['off', 'on'] as const;
const onOnly: AnyRule = { t: 'toward', only: 'on' };
export const OPTION_ALLOW: Readonly<Record<string, AnyRule>> = {
  // cosmetic / UI
  'ruflo-console.bar': { t: 'free' }, 'ruflo-console.boot': { t: 'free' }, 'ruflo-console.look': { t: 'free' }, 'ruflo-console.panel': { t: 'free' }, 'ruflo-console.eventsPersist': { t: 'free' },
  'ruflo-console.fps': { t: 'range', min: 1, max: 60 }, 'ruflo-console.refreshSeconds': { t: 'range', min: 1, max: 3600 }, 'ruflo-swarm.panel': { t: 'free' },
  'ruflo-mods.statusLine': { t: 'free' }, 'ruflo-mods.routeContext': { t: 'free' }, 'ruflo-mods.compactCarry': { t: 'free' }, 'ruflo-mods.sessionRollup': { t: 'free' }, 'ruflo-mods.toolHints': { t: 'free' },
  // safety options: only toward the safer value
  'ruflo-mods.deliveryScreen': { t: 'toward', to: true }, 'ruflo-mods.costHardStop': { t: 'toward', to: true }, 'ruflo-swarm.audit': { t: 'toward', to: true },
  'ruflo-protector.mode': { t: 'toward', order: ['off', 'learn', 'notify', 'enforce'] },
  'ruflo-neural-trader.liveGuard': onOnly, 'ruflo-browser.strictUrls': onOnly, 'ruflo-bbs-federation.allowWildcardBind': { t: 'toward', only: 'off' },
  'ruflo-intelligence.confirmReset': onOnly, 'ruflo-iot-cognitum.confirmDestructive': onOnly, 'ruflo-jujutsu.confirmPrActions': onOnly, 'ruflo-knowledge-graph.confirmDeletes': onOnly,
  // budget and size caps: lower only
  'ruflo-mods.costBudgetUsd': { t: 'cap', min: 0, max: 100000 }, 'ruflo-console.wfBudgetRunUsd': { t: 'cap', min: 0, max: 100000 }, 'ruflo-console.wfBudgetDayUsd': { t: 'cap', min: 0, max: 100000 },
  'ruflo-autopilot.iterationCap': { t: 'cap', min: 1, max: 100000 }, 'ruflo-loop-workers.maxDispatch': { t: 'cap', min: 1, max: 100000 }, 'ruflo-chatgpt-federation.maxPayloadBytes': { t: 'cap', min: 1, max: 10_000_000 },
};
/** Every `<plugin>.guard` option is a safety switch that may only be turned on. */
const ruleFor = (plugin: string, key: string): AnyRule | undefined => OPTION_ALLOW[`${plugin}.${key}`] ?? (key === 'guard' ? { t: 'toward', only: 'on' } as AnyRule : undefined);

interface Raw { type?: unknown; default?: unknown; options?: unknown; enum?: unknown; sensitive?: unknown }
const scalar = (v: unknown): boolean | number | string | undefined => (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) ? v : typeof v === 'string' ? v.slice(0, 64) : undefined);

export function classifyOption(plugin: string, key: string, raw: Raw): CatalogOption {
  const type = typeof raw.type === 'string' ? raw.type.slice(0, 16) : 'string';
  const choicesRaw = Array.isArray(raw.options) ? raw.options : Array.isArray(raw.enum) ? raw.enum : undefined;
  const choices = choicesRaw?.filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(c)).slice(0, 12);
  const def = scalar(raw.default);
  const base: CatalogOption = { key, type, ...(def !== undefined ? { default: def } : {}), ...(choices?.length ? { choices } : {}), settable: false };
  const no = (why: RefuseCode): CatalogOption => ({ ...base, why });
  if (raw.sensitive === true || SECRETISH.test(key)) return no('secret-option');
  const rule = ruleFor(plugin, key);
  if (!rule) return no('not-settable');
  // The manifest has to agree with the rule's shape; a plugin that changes an option's type does not get a different rule.
  if (rule.t === 'cap' || rule.t === 'range') return type === 'number' ? { ...base, settable: true, rule: rule.t, cap: rule.t === 'cap', min: rule.min, max: rule.max } : no('not-settable');
  if (type === 'boolean') return { ...base, settable: true, rule: rule.t === 'free' ? 'bool' : 'toward', ...(rule.t === 'toward' ? { toward: rule } : {}) };
  if (type === 'string' && choices?.length) return { ...base, settable: true, rule: rule.t === 'free' ? 'enum' : 'toward', ...(rule.t === 'toward' ? { toward: rule } : {}) };
  return no('not-settable');
}

export type OptionCheck = { ok: true; value: boolean | number | string } | { ok: false; code: RefuseCode | 'bad_value' | 'config_unreadable' };
const str = (v: unknown): string => String(v);
/** Validate a requested value against the option's rule; `current` is the value now in effect (undefined = unset, falls back to the manifest default). */
export function checkOptionValue(opt: CatalogOption, value: unknown, current: unknown): OptionCheck {
  if (!opt.settable) return { ok: false, code: opt.why ?? 'not-settable' };
  const effective = current ?? opt.default;
  if (opt.rule === 'bool' || opt.rule === 'toward' && typeof value === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, code: 'bad_value' };
    if (opt.rule === 'toward' && opt.toward?.t === 'toward' && opt.toward.to !== undefined && value !== opt.toward.to) return { ok: false, code: 'loosens-gate' };
    return { ok: true, value };
  }
  if (opt.rule === 'enum' || opt.rule === 'toward') {
    if (typeof value !== 'string' || !opt.choices?.includes(value)) return { ok: false, code: 'bad_value' };
    const t = opt.toward;
    if (opt.rule === 'toward' && t?.t === 'toward') {
      if (t.only !== undefined) { if (value !== t.only) return { ok: false, code: 'loosens-gate' }; }
      else if (t.order) {
        const now = t.order.indexOf(str(effective)); const next = t.order.indexOf(value);
        if (now < 0 || next < 0) return { ok: false, code: 'config_unreadable' };
        if (next < now) return { ok: false, code: 'loosens-gate' };
      }
    }
    return { ok: true, value };
  }
  if (opt.rule === 'range' || opt.rule === 'cap') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (opt.min ?? 0) || value > (opt.max ?? 0)) return { ok: false, code: 'bad_value' };
    if (opt.rule === 'cap') {
      // Unset (undefined, or the real CLI's empty string) means "no cap yet": a first finite positive cap is a tightening from unlimited.
      // A non-empty value that is not a number is garbled and never read as "no cap".
      const unset = effective === undefined || effective === null || (typeof effective === 'string' && effective.trim() === '');
      const cur = unset ? 0 : typeof effective === 'number' ? effective : typeof effective === 'string' ? Number(effective) : NaN;
      if (!Number.isFinite(cur)) return { ok: false, code: 'config_unreadable' };
      if (unset) { if (!(value > 0)) return { ok: false, code: 'would-raise-cap' }; }
      // For caps whose minimum is 0, 0 is "no cap": going to 0, or above a cap that is set, loosens it.
      else if ((opt.min ?? 0) === 0) { if (value === 0 && cur !== 0) return { ok: false, code: 'would-raise-cap' }; if (cur > 0 && value > cur) return { ok: false, code: 'would-raise-cap' }; }
      else if (value > cur) return { ok: false, code: 'would-raise-cap' };
    }
    return { ok: true, value };
  }
  return { ok: false, code: 'not-settable' };
}
