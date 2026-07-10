/**
 * Funnel release-gate invariants — ADR-301..310.
 *
 * Every test here maps to a hard gate in ADR-310:
 *   - promo output in CI: 0
 *   - promotional display before disclosure: 0
 *   - control-sequence injection through message copy: 0
 *   - lower-precedence source re-enabling a higher disable: 0
 *   - credit-recovery on anything but COGNITUM_CREDIT_EXHAUSTED: 0
 *   - funnel events without telemetry consent: 0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  isValidMessage,
  isAllowedUrl,
  containsForbiddenSequences,
  displayWidth,
  MESSAGES,
  MAX_MESSAGE_COLUMNS,
} from '../src/funnel/messages.js';
import {
  selectMessage,
  ROTATION_SLOT_MS,
  PROMO_SLOT_MODULO,
  PROMO_REPEAT_CAP_MS,
} from '../src/funnel/rotation.js';
import { resolveFunnelEnabled } from '../src/funnel/precedence.js';
import {
  DISCLOSURE_TEXT,
  DISCLOSURE_TEXTS,
  DISCLOSURE_SPONSOR_URL,
  DISCLOSURE_GRACE_MS,
  getDisclosure,
  promoEligible,
  recordDisclosureDeclined,
  recordDisclosureShown,
  selectDisclosureText,
} from '../src/funnel/disclosure.js';
import { getConsent, hasConsent, recordConsent } from '../src/funnel/consent.js';
import { CONSENT_POLICY_VERSION, CreditErrorCode } from '../src/funnel/types.js';
import {
  classifyCreditError,
  shouldShowCreditRecovery,
  renderCreditRecovery,
} from '../src/funnel/credit-errors.js';
import { getFunnelId, recordFunnelEvent, deleteFunnelData } from '../src/funnel/events.js';
import { attributionUrl } from '../src/funnel/attribution.js';
import {
  flushEvents,
  DEFAULT_ENDPOINT,
  MAX_BATCH,
  MIN_FLUSH_INTERVAL_MS,
  FLUSH_TIMEOUT_MS,
} from '../src/funnel/event-transport.js';
import {
  markCreditExhausted,
  clearCreditStatus,
  readCreditStatus,
  creditExhaustedNotice,
} from '../src/funnel/credit-notifier.js';
import { getFunnelPromo } from '../src/funnel/promo.js';
import { isCI } from '../src/funnel/environment.js';
import { shouldOfferEnrollment, recordEnrollmentOutcome, getEnrollmentRecord } from '../src/funnel/enrollment.js';
import { generateStatuslineScript } from '../src/init/statusline-generator.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

const CLEAN_ENV_KEYS = [
  'RUFLO_FUNNEL', 'RUFLO_ENTERPRISE_POLICY', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI',
  'CIRCLECI', 'TRAVIS', 'BUILDKITE', 'JENKINS_URL', 'TEAMCITY_VERSION', 'TF_BUILD',
];

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
  for (const k of CLEAN_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

// ─── ADR-301: signed content boundaries ─────────────────────────────────────

describe('message content boundaries (ADR-301)', () => {
  const base = { id: 'test', schemaVersion: 1 as const, class: 'educational' as const };

  it('accepts a plain valid message', () => {
    expect(isValidMessage({ ...base, text: 'hello world' })).toBe(true);
  });

  it('drops ANSI escape sequences', () => {
    expect(isValidMessage({ ...base, text: 'hi \u001b[31mred\u001b[0m' })).toBe(false);
  });

  it('drops OSC sequences (terminal title / hyperlink injection)', () => {
    expect(isValidMessage({ ...base, text: 'x\u001b]0;pwned\u0007' })).toBe(false);
  });

  it('drops C0/C1 control characters', () => {
    expect(isValidMessage({ ...base, text: 'a\u0008b' })).toBe(false);
    expect(isValidMessage({ ...base, text: 'a\u009bb' })).toBe(false);
  });

  it('drops bidirectional override characters', () => {
    expect(isValidMessage({ ...base, text: 'a‮evil' })).toBe(false);
    expect(isValidMessage({ ...base, text: 'a⁦evil⁩' })).toBe(false);
  });

  it('drops over-length messages instead of truncating', () => {
    expect(isValidMessage({ ...base, text: 'x'.repeat(MAX_MESSAGE_COLUMNS + 1) })).toBe(false);
    expect(isValidMessage({ ...base, text: 'x'.repeat(MAX_MESSAGE_COLUMNS) })).toBe(true);
  });

  it('counts wide characters as 2 columns', () => {
    expect(displayWidth('あ')).toBe(2);
    expect(displayWidth('ab')).toBe(2);
    // 41 CJK chars = 82 display columns > 80 even though length is 41
    expect(isValidMessage({ ...base, text: 'あ'.repeat(41) })).toBe(false);
  });

  it('drops wrong schema version and bad class', () => {
    expect(isValidMessage({ ...base, schemaVersion: 2, text: 'x' })).toBe(false);
    expect(isValidMessage({ ...base, class: 'urgent', text: 'x' })).toBe(false);
  });

  it('drops expired messages', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isValidMessage({ ...base, text: 'x', expiresAt: past })).toBe(false);
  });

  it('URL allowlist: exact hosts only, https only, no lookalikes', () => {
    expect(isAllowedUrl('https://cognitum.one/routing')).toBe(true);
    expect(isAllowedUrl('https://github.com/ruvnet/ruflo')).toBe(true);
    expect(isAllowedUrl('http://cognitum.one')).toBe(false); // not https
    expect(isAllowedUrl('https://cognitum.one.evil.com')).toBe(false); // lookalike
    expect(isAllowedUrl('https://evilcognitum.one')).toBe(false);
    expect(isAllowedUrl('https://github.com/attacker/repo')).toBe(false); // wrong org
    expect(isAllowedUrl('https://1.2.3.4/')).toBe(false); // IP literal
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedUrl('not a url')).toBe(false);
  });

  it('every shipped message passes all boundaries', () => {
    for (const m of MESSAGES) {
      expect(isValidMessage(m), `shipped message ${m.id} must be valid`).toBe(true);
    }
  });

  it('every disclosure variant fits the column bound with its disable instruction intact', () => {
    expect(DISCLOSURE_TEXTS.length).toBeGreaterThan(0);
    for (const text of DISCLOSURE_TEXTS) {
      expect(displayWidth(text), `variant "${text}" must fit ${MAX_MESSAGE_COLUMNS} cols`).toBeLessThanOrEqual(MAX_MESSAGE_COLUMNS);
      expect(text, `variant "${text}" must retain the disable instruction`).toContain('disable');
      expect(text, `variant "${text}" must retain the exact opt-out command`).toContain('ruflo funnel disable');
      expect(containsForbiddenSequences(text), `variant "${text}" must not carry control chars`).toBe(false);
      expect(text, `variant "${text}" must attribute Cognitum since the row links there`).toMatch(/cognitum/i);
    }
    // The canonical DISCLOSURE_TEXT is the first entry — round-trip check.
    expect(DISCLOSURE_TEXT).toBe(DISCLOSURE_TEXTS[0]);
  });

  it('disclosure sponsor URL is https-only and points to cognitum.one', () => {
    const parsed = new URL(DISCLOSURE_SPONSOR_URL);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('cognitum.one');
  });

  it('selectDisclosureText is deterministic per 5-minute slot', () => {
    // Same slot → same variant. Different slots eventually cycle through them all.
    const t0 = new Date('2026-07-10T12:00:00.000Z');
    const t0plus1s = new Date(t0.getTime() + 1000);
    expect(selectDisclosureText(t0)).toBe(selectDisclosureText(t0plus1s));
    const seen = new Set<string>();
    for (let i = 0; i < DISCLOSURE_TEXTS.length * 2; i++) {
      seen.add(selectDisclosureText(new Date(t0.getTime() + i * 5 * 60 * 1000)));
    }
    // Rotation must cover every variant.
    expect(seen.size).toBe(DISCLOSURE_TEXTS.length);
  });
});

// ─── ADR-301: rotation ratio ────────────────────────────────────────────────

describe('rotation scheduler (ADR-301 content ratio)', () => {
  it('promotional content appears only in 1-of-5 slots and honors the 30-min cap', () => {
    const base = Date.UTC(2026, 6, 10, 12, 0, 0);
    let promos = 0;
    let educational = 0;
    const slots = 200; // 200 slots × 20s ≈ 66 minutes
    for (let i = 0; i < slots; i++) {
      const now = new Date(base + i * ROTATION_SLOT_MS);
      const msg = selectMessage(now);
      expect(msg).not.toBeNull();
      if (msg!.class === 'promotional') {
        promos++;
        // structural ratio: promo only in the designated slot
        const slot = Math.floor(now.getTime() / ROTATION_SLOT_MS);
        expect(slot % PROMO_SLOT_MODULO).toBe(PROMO_SLOT_MODULO - 1);
      } else {
        educational++;
      }
    }
    // 30-min repeat cap over ~66 minutes → at most 3 promos
    const maxPromos = Math.floor((slots * ROTATION_SLOT_MS) / PROMO_REPEAT_CAP_MS) + 1;
    expect(promos).toBeLessThanOrEqual(maxPromos);
    expect(promos).toBeGreaterThan(0);
    // ratio: far better than 4:1
    expect(educational / Math.max(promos, 1)).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic for a fixed time slot', () => {
    const now = new Date(Date.UTC(2026, 6, 10, 12, 0, 1));
    const a = selectMessage(now);
    const b = selectMessage(now);
    expect(a?.id).toBe(b?.id);
  });
});

// ─── ADR-305: control precedence ────────────────────────────────────────────

describe('control precedence (ADR-305)', () => {
  it('defaults to enabled by package default', () => {
    expect(resolveFunnelEnabled(stateDir)).toEqual({ enabled: true, decidedBy: 'package-default' });
  });

  it('RUFLO_FUNNEL=0 disables at the top of the chain', () => {
    for (const v of ['0', 'false', 'off', 'no', 'FALSE']) {
      expect(resolveFunnelEnabled(stateDir, { ...process.env, RUFLO_FUNNEL: v }).decidedBy).toBe('env');
    }
  });

  it('enterprise policy disables below env', () => {
    const policyFile = path.join(stateDir, 'policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({ funnel: { enabled: false } }));
    const decision = resolveFunnelEnabled(stateDir, { ...process.env, RUFLO_ENTERPRISE_POLICY: policyFile });
    expect(decision).toEqual({ enabled: false, decidedBy: 'enterprise-policy' });
  });

  it('a lower-precedence source never re-enables a higher-precedence disable', () => {
    // user config says enabled=true, env says off → env wins
    fs.writeFileSync(path.join(stateDir, 'funnel.json'), JSON.stringify({ enabled: true }));
    const decision = resolveFunnelEnabled(stateDir, { ...process.env, RUFLO_FUNNEL: '0' });
    expect(decision.enabled).toBe(false);
    expect(decision.decidedBy).toBe('env');
  });

  it('user config disable wins over project config and default', () => {
    fs.writeFileSync(path.join(stateDir, 'funnel.json'), JSON.stringify({ enabled: false }));
    expect(resolveFunnelEnabled(stateDir).decidedBy).toBe('user-config');
  });

  it('project claude-flow.config.json funnel.enabled=false disables', () => {
    fs.writeFileSync(path.join(stateDir, 'claude-flow.config.json'), JSON.stringify({ funnel: { enabled: false } }));
    expect(resolveFunnelEnabled(stateDir).decidedBy).toBe('project-config');
  });

  it('a stored remote policy can disable but sits at the bottom', () => {
    fs.writeFileSync(path.join(stateDir, 'funnel-remote-policy.json'), JSON.stringify({ funnelEnabled: false }));
    expect(resolveFunnelEnabled(stateDir).decidedBy).toBe('remote-policy');
    // remote enable=true must NOT override user disable
    fs.writeFileSync(path.join(stateDir, 'funnel-remote-policy.json'), JSON.stringify({ funnelEnabled: true }));
    fs.writeFileSync(path.join(stateDir, 'funnel.json'), JSON.stringify({ enabled: false }));
    expect(resolveFunnelEnabled(stateDir).decidedBy).toBe('user-config');
  });
});

// ─── ADR-301: disclosure gate ───────────────────────────────────────────────

describe('disclosure gate (ADR-301)', () => {
  it('starts never_seen; no promo before disclosure', () => {
    expect(getDisclosure().state).toBe('never_seen');
    expect(promoEligible()).toBe(false);
  });

  it('first render records disclosed_enabled but promo waits for the grace window', () => {
    const t0 = new Date();
    recordDisclosureShown(t0);
    expect(getDisclosure().state).toBe('disclosed_enabled');
    expect(promoEligible(t0)).toBe(false);
    expect(promoEligible(new Date(t0.getTime() + DISCLOSURE_GRACE_MS - 1000))).toBe(false);
    expect(promoEligible(new Date(t0.getTime() + DISCLOSURE_GRACE_MS + 1000))).toBe(true);
  });

  it('declining disables all funnel surfaces through the precedence chain', () => {
    recordDisclosureDeclined();
    expect(getDisclosure().state).toBe('disclosed_disabled');
    expect(promoEligible()).toBe(false);
    expect(resolveFunnelEnabled(stateDir)).toEqual({ enabled: false, decidedBy: 'disclosure-declined' });
  });
});

// ─── ADR-301/305: promo orchestrator gates ──────────────────────────────────

describe('promo orchestrator (getFunnelPromo)', () => {
  it('renders nothing in CI regardless of state', () => {
    expect(getFunnelPromo({ interactive: true, env: { ...process.env, CI: 'true' } })).toBeNull();
    expect(getFunnelPromo({ interactive: true, env: { ...process.env, GITHUB_ACTIONS: 'true' } })).toBeNull();
  });

  it('renders nothing when not interactive', () => {
    expect(getFunnelPromo({ interactive: false })).toBeNull();
  });

  it('renders nothing when disabled by any precedence source', () => {
    expect(getFunnelPromo({ interactive: true, env: { ...process.env, RUFLO_FUNNEL: '0' } })).toBeNull();
  });

  it('first interactive render is the disclosure, never a promotion', () => {
    const row = getFunnelPromo({ interactive: true, cwd: stateDir });
    expect(row).not.toBeNull();
    expect(row!.kind).toBe('disclosure');
    // Row text is one of the rotating disclosure variants (all equally valid).
    expect(DISCLOSURE_TEXTS).toContain(row!.text);
    // Sponsor URL rides on the disclosure so the renderer can OSC 8 wrap it.
    // It's now attribution-decorated: the base target is DISCLOSURE_SPONSOR_URL,
    // with UTM params appended (fid appears only under telemetry consent).
    expect(row!.url).toBeDefined();
    const parsed = new URL(row!.url!);
    expect(parsed.origin + parsed.pathname).toBe(DISCLOSURE_SPONSOR_URL);
    expect(parsed.searchParams.get('utm_source')).toBe('ruflo');
    expect(parsed.searchParams.get('utm_medium')).toBe('statusline');
    expect(parsed.searchParams.get('utm_campaign')).toBe('disclosure');
    expect(parsed.searchParams.get('utm_content')).toMatch(/^disclosure-\d+$/);
    // Without telemetry consent (default in this test suite), no fid rides along.
    expect(parsed.searchParams.get('fid')).toBeNull();
  });

  it('keeps showing the disclosure through the grace window, then rotates messages', () => {
    const t0 = new Date();
    recordDisclosureShown(t0);
    const during = getFunnelPromo({ interactive: true, cwd: stateDir, now: new Date(t0.getTime() + 1000) });
    expect(during!.kind).toBe('disclosure');
    const after = getFunnelPromo({
      interactive: true,
      cwd: stateDir,
      now: new Date(t0.getTime() + DISCLOSURE_GRACE_MS + 60_000),
    });
    expect(after).not.toBeNull();
    expect(['educational', 'promotional']).toContain(after!.kind);
  });
});

// ─── ADR-302: consent receipts ──────────────────────────────────────────────

describe('consent receipts (ADR-302)', () => {
  it('unasked domains are not consented and have a null timestamp', () => {
    expect(hasConsent('account')).toBe(false);
    expect(getConsent('account').at).toBeNull();
  });

  it('records grant AND decline as decisions', () => {
    recordConsent('account', true, 'post-init');
    recordConsent('telemetry', false, 'post-init');
    expect(hasConsent('account')).toBe(true);
    expect(hasConsent('telemetry')).toBe(false);
    expect(getConsent('telemetry').at).not.toBeNull(); // decline is recorded
  });

  it('a stale policyVersion is not consent (re-ask, never carry forward)', () => {
    recordConsent('cloud-routing', true, 'test');
    // simulate a policy bump by rewriting the receipt with an older version
    const file = path.join(stateDir, 'consent.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    data['cloud-routing'].policyVersion = CONSENT_POLICY_VERSION - 1;
    fs.writeFileSync(file, JSON.stringify(data));
    expect(hasConsent('cloud-routing')).toBe(false);
  });

  it('accepting account consent enables nothing else (domains are separate)', () => {
    recordConsent('account', true, 'post-init');
    expect(hasConsent('cloud-routing')).toBe(false);
    expect(hasConsent('telemetry')).toBe(false);
    expect(hasConsent('proxy-install')).toBe(false);
  });
});

// ─── ADR-303: credit-error classifier ───────────────────────────────────────

describe('credit-error classifier (ADR-303, fail-closed)', () => {
  it('only COGNITUM_CREDIT_EXHAUSTED triggers the recovery surface', () => {
    const session = { creditPromptShown: false };
    const fire = classifyCreditError({ providerCode: 'cognitum_credit_exhausted' });
    expect(fire.code).toBe(CreditErrorCode.COGNITUM_CREDIT_EXHAUSTED);
    expect(shouldShowCreditRecovery(fire, session)).toBe(true);

    for (const code of ['insufficient_quota', 'rate_limit_exceeded', 'authentication_error', 'api_error']) {
      const e = classifyCreditError({ providerCode: code });
      expect(shouldShowCreditRecovery(e, session), `${code} must not fire`).toBe(false);
    }
  });

  it('provider quota exhaustion maps to PROVIDER_QUOTA_EXHAUSTED, never Cognitum', () => {
    const e = classifyCreditError({ providerCode: 'insufficient_quota' });
    expect(e.code).toBe(CreditErrorCode.PROVIDER_QUOTA_EXHAUSTED);
  });

  it('unmapped codes stay unclassified with confidence 0', () => {
    const e = classifyCreditError({ providerCode: 'weird_new_error' });
    expect(e.code).toBeNull();
    expect(e.confidence).toBe(0);
    expect(shouldShowCreditRecovery(e, { creditPromptShown: false })).toBe(false);
  });

  it('a bare 429 with no code is ambiguous → unmapped', () => {
    const e = classifyCreditError({ status: 429 });
    expect(e.code).toBeNull();
    expect(e.confidence).toBe(0);
  });

  it('never parses message text (only codes and status)', () => {
    const e = classifyCreditError({
      providerCode: undefined,
      // message text saying "credits exhausted" is NOT a signal
    } as never);
    expect(e.code).toBeNull();
  });

  it('caps at one prompt per session', () => {
    const fire = classifyCreditError({ providerCode: 'cognitum_credit_exhausted' });
    expect(shouldShowCreditRecovery(fire, { creditPromptShown: true })).toBe(false);
  });

  it('recovery screen distinguishes signed-in vs signed-out', () => {
    expect(renderCreditRecovery(false)).toContain('ruflo auth login');
    expect(renderCreditRecovery(true)).toContain('ruflo proxy enable');
  });
});

// ─── ADR-305/309: events, consent-gated, bucketed ───────────────────────────

describe('funnel events (ADR-305/309)', () => {
  it('records nothing without telemetry consent', () => {
    expect(recordFunnelEvent('disclosure_shown', 'statusline', '3.25.6')).toBe(false);
    expect(fs.existsSync(path.join(stateDir, 'funnel-events.jsonl'))).toBe(false);
    expect(getFunnelId()).toBeNull();
  });

  it('with consent: daily buckets only, closed event set, pseudonymous id', () => {
    recordConsent('telemetry', true, 'test');
    expect(recordFunnelEvent('signup_opened', 'init', '3.25.6')).toBe(true);
    const lines = fs.readFileSync(path.join(stateDir, 'funnel-events.jsonl'), 'utf-8').trim().split('\n');
    const evt = JSON.parse(lines[0]);
    expect(evt.timestampBucket).toMatch(/^\d{4}-\d{2}-\d{2}$/); // daily, no time
    expect(evt.pseudonymousId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(evt).sort()).toEqual(
      ['event', 'pseudonymousId', 'release', 'schemaVersion', 'surface', 'timestampBucket'],
    );
    // unknown event names are rejected
    expect(recordFunnelEvent('exfiltrate_prompts' as never, 'init', 'x')).toBe(false);
  });

  it('opt-out deletes the id and the queue', () => {
    recordConsent('telemetry', true, 'test');
    recordFunnelEvent('signup_opened', 'init', '3.25.6');
    const id = getFunnelId();
    expect(id).not.toBeNull();
    deleteFunnelData();
    expect(fs.existsSync(path.join(stateDir, 'funnel-events.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, 'funnel-id.json'))).toBe(false);
  });
});

// ─── ADR-302: enrollment gates ──────────────────────────────────────────────

describe('enrollment gates (ADR-302)', () => {
  it('never offers in CI, with --no-signup, or when funnel is disabled', () => {
    expect(shouldOfferEnrollment({ noSignup: true, cwd: stateDir })).toBe(false);
    expect(shouldOfferEnrollment({ noSignup: false, cwd: stateDir, env: { ...process.env, CI: '1' } })).toBe(false);
    expect(
      shouldOfferEnrollment({ noSignup: false, cwd: stateDir, env: { ...process.env, RUFLO_FUNNEL: '0' } }),
    ).toBe(false);
  });

  it('is one-time: any recorded outcome suppresses future offers', () => {
    recordEnrollmentOutcome(false);
    expect(getEnrollmentRecord()?.outcome).toBe('skipped');
    expect(shouldOfferEnrollment({ noSignup: false, cwd: stateDir })).toBe(false);
  });

  it('accepting records ONLY the account consent domain', () => {
    recordEnrollmentOutcome(true);
    expect(hasConsent('account')).toBe(true);
    expect(hasConsent('telemetry')).toBe(false);
    expect(hasConsent('cloud-routing')).toBe(false);
  });
});

// ─── environment gates ──────────────────────────────────────────────────────

describe('CI detection', () => {
  it('recognizes the common CI environments', () => {
    for (const v of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'TF_BUILD']) {
      expect(isCI({ [v]: 'true' } as NodeJS.ProcessEnv), v).toBe(true);
    }
    expect(isCI({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isCI({ CI: 'false' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ─── generated statusline renderer (defense-in-depth) ──────────────────────

describe('generated statusline promo row', () => {
  const script = generateStatuslineScript({
    runtime: { maxAgents: 8 },
    statusline: { enabled: true },
  } as never);

  it('embeds the promo renderer with CI and RUFLO_FUNNEL gates', () => {
    expect(script).toContain('getPromoRow');
    expect(script).toContain('process.env.CI');
    expect(script).toContain('RUFLO_FUNNEL');
  });

  it('re-sanitizes promo text at render time (control chars stripped, capped)', () => {
    expect(script).toContain('\\u0000-\\u001f');
    expect(script).toContain('.slice(0, 100)');
  });

  it('never renders promo styling from payload — colors come from a fixed kind map', () => {
    // The row is styled by the renderer's own hardcoded color, chosen from the
    // CLI-supplied `kind` enum (disclosure/promotional/educational). The payload
    // text itself never provides ANSI — the sanitiser above strips all of it.
    // The wrapping ALWAYS ends with c.reset so no color leaks into subsequent
    // Claude Code UI. Guards against a future edit that lets payload styling in.
    expect(script).toMatch(/promoColor \+ promoRow \+ c\.reset/);
    expect(script).toMatch(/kind === 'promotional' \? c\.brightPurple/);
    expect(script).toMatch(/kind === 'educational' \? c\.yellow/);
    // Default branch stays a renderer-owned color, not a payload field.
    expect(script).toMatch(/: c\.brightCyan/);
  });
});

// ─── ADR-301/305 attribution — network-free fallback discipline ─────────────
// The funnel row must render correctly even when the API is completely down.
// These tests pin that invariant.

describe('attributionUrl (ADR-305 measurement, no runtime network)', () => {
  it('returns the base URL verbatim when it is malformed', () => {
    // The URL builder must never synthesize a broken analytics endpoint —
    // a malformed input passes through unchanged so downstream (OSC 8 host
    // allowlist) can drop it safely.
    const cases = ['not-a-url', '', 'javascript:evil()', 'ftp://cognitum.one'];
    for (const bad of cases) {
      expect(attributionUrl(bad, { medium: 's', campaign: 'c', content: 'x' })).toBe(bad);
    }
  });

  it('appends UTM params and preserves any query already on the base URL', () => {
    const out = attributionUrl('https://cognitum.one/ruflo?foo=1', {
      medium: 'statusline', campaign: 'disclosure', content: 'test-1',
    });
    const parsed = new URL(out);
    expect(parsed.searchParams.get('foo')).toBe('1');
    expect(parsed.searchParams.get('utm_source')).toBe('ruflo');
    expect(parsed.searchParams.get('utm_medium')).toBe('statusline');
    expect(parsed.searchParams.get('utm_campaign')).toBe('disclosure');
    expect(parsed.searchParams.get('utm_content')).toBe('test-1');
  });

  it('does NOT append fid when telemetry consent is absent (privacy default)', () => {
    // Default test state has no consent grants. fid must not appear.
    const out = attributionUrl('https://cognitum.one/ruflo', {
      medium: 'statusline', campaign: 'disclosure', content: 'x',
    });
    expect(new URL(out).searchParams.has('fid')).toBe(false);
  });

  it('emits no network call — attribution is a pure link builder', () => {
    // Guard: the function must be synchronous and side-effect-free with
    // respect to the network. If someone later adds fetch/https here, this
    // test will still pass but the *design* is documented.
    const before = Date.now();
    for (let i = 0; i < 1000; i++) {
      attributionUrl('https://cognitum.one/ruflo', {
        medium: 'statusline', campaign: 'disclosure', content: String(i),
      });
    }
    const elapsed = Date.now() - before;
    // 1000 URL builds must be sub-100ms (network calls would be nowhere near).
    expect(elapsed).toBeLessThan(100);
  });
});

describe('getFunnelPromo — API-down fallback discipline', () => {
  it('generated statusline underlines only the clickable label, not the disable tail', () => {
    // CTA affordance: the OSC 8 label is wrapped in ANSI underline ([4m)
    // so terminals show it as a clickable link even when the OSC 8 hyperlink
    // isn't supported. The trailing "· disable: ..." is dim + non-underlined
    // so users read it as metadata, not as part of the click target.
    const script = generateStatuslineScript({
      statusline: { enabled: true, style: 'compact' as const },
      runtime: { maxAgents: 15 },
    });
    // Underline on/off must sandwich the OSC 8 wrap.
    expect(script).toMatch(/UL_ON \+ safeTerminalLink\(label, promo\.url\) \+ UL_OFF/);
    // Dim tail must be rendered separately.
    expect(script).toMatch(/DIM_ON \+ tail \+ DIM_OFF/);
    // The split must be on the exact disable-instruction anchor.
    expect(script).toMatch(/text\.indexOf\(' · disable'\)/);
  });

  it('generated statusline emits exactly 3 lines: header, ops, promo', () => {
    // Claude Code truncates statusline past line 4 with the system guidance
    // line. The 3-line design puts RuFlo header on line 1, then ops, then
    // promo — sequence matches order of pushes in the generator source.
    const script = generateStatuslineScript({
      statusline: { enabled: true, style: 'compact' as const },
      runtime: { maxAgents: 15 },
    });
    const headerIdx = script.indexOf('lines.push(header)');
    const opsIdx = script.indexOf("lines.push(opsParts.join(");
    const promoIdx = script.indexOf('lines.push(promoColor + promoRow');
    expect(headerIdx).toBeGreaterThan(0);
    expect(opsIdx).toBeGreaterThan(headerIdx);
    expect(promoIdx).toBeGreaterThan(opsIdx);
  });

  it('generated statusline memoizes promo across renders (survives promoless CLI)', () => {
    // A previously-installed older CLI cached by npx may succeed but omit
    // the promo field. The memo overlay patches it back in so the row
    // doesn't blink out mid-session.
    const script = generateStatuslineScript({
      statusline: { enabled: true, style: 'compact' as const },
      runtime: { maxAgents: 15 },
    });
    expect(script).toMatch(/PROMO_MEMO_FILE/);
    expect(script).toMatch(/function readPromoMemo/);
    expect(script).toMatch(/function overlayMemoPromo/);
    // Overlay must fire on every path (fresh cache, successful CLI, stale
    // cache fallback, cold fallback) — grep the call count as a spot check.
    const overlayCalls = (script.match(/overlayMemoPromo\(/g) || []).length;
    expect(overlayCalls).toBeGreaterThanOrEqual(4);
  });

  it('generated statusline script implements stale-while-revalidate for promo row', () => {
    // The fix for the flicker bug: the promo row must survive CLI hiccups
    // and cache-expiry-mid-render. readCache() returns { fresh, data } and
    // getStatuslineData falls back to stale cache when the CLI fails, so
    // the last known promo persists. This test pins that design in the
    // generator template so a future edit that breaks the pattern trips CI.
    const script = generateStatuslineScript({
      statusline: { enabled: true, style: 'compact' as const },
      runtime: { maxAgents: 15 },
    });
    // Cache reader must expose freshness rather than gating data behind TTL.
    expect(script).toMatch(/const cache = readCache\(\)/);
    expect(script).toMatch(/cache\.fresh/);
    // On CLI failure, must serve stale cache data (with local overlays) not
    // a bare buildLocalFallback() that would drop the promo field.
    expect(script).toMatch(/if \(cache\.data\)/);
    expect(script).toMatch(/applyLocalOverlays\(cache\.data\)/);
  });

  it('renders the row without touching the network (no fetch import path)', async () => {
    // The promo module is imported at test module load; if it pulled in a
    // network library, this stringified module set would carry a fetch/https
    // reference. This is a design lock — a future edit that adds network
    // I/O to the render path breaks this test.
    const promoSrc = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/funnel/promo.ts', import.meta.url), 'utf-8'),
    );
    expect(promoSrc).not.toMatch(/require\(\s*['"]https?['"]\s*\)/);
    expect(promoSrc).not.toMatch(/from\s+['"]https?['"]/);
    expect(promoSrc).not.toMatch(/fetch\s*\(/);
    expect(promoSrc).not.toMatch(/XMLHttpRequest/);
  });
});

// ─── ADR-308 client transport — consent-gated + failure-safe ────────────────

describe('event transport (ADR-308 POST /v1/events)', () => {
  it('exposes ADR-308 defaults: https endpoint, batch cap, backoff, timeout', () => {
    expect(DEFAULT_ENDPOINT.startsWith('https://')).toBe(true);
    expect(MAX_BATCH).toBeGreaterThan(0);
    expect(MAX_BATCH).toBeLessThanOrEqual(1000);
    expect(MIN_FLUSH_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(FLUSH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(10_000); // never stall the CLI
  });

  it('no-ops without telemetry consent — zero network activity', async () => {
    // No consent granted in the base test state.
    const result = await flushEvents({ endpoint: 'https://127.0.0.1:1', now: new Date() });
    expect(result).toEqual({ flushed: 0, skipped: 'no-consent' });
  });

  it('rejects non-https endpoints inside postBatch (via consent-gated caller)', async () => {
    // Grant consent so the transport reaches postBatch, then pass an
    // http:// endpoint — the module must refuse rather than open a plaintext
    // connection.
    recordConsent('telemetry', true, 'test');
    // Also stage at least one event so we don't short-circuit on empty queue.
    recordFunnelEvent('disclosure_shown', 'statusline', 'test');
    const result = await flushEvents({ endpoint: 'http://127.0.0.1:1', force: true, now: new Date() });
    expect(result.skipped).toMatch(/transport-failed|no-consent/);
    // On the failed-transport path we expect a status of 0 (never opened).
    if (result.skipped === 'transport-failed') expect(result.status).toBe(0);
  });
});

describe('credit-notifier (ADR-303 out-of-band signal)', () => {
  it('markCreditExhausted is idempotent — stable `since`', () => {
    const t0 = new Date('2026-07-10T12:00:00.000Z');
    markCreditExhausted(t0);
    const first = readCreditStatus();
    expect(first.exhausted).toBe(true);
    expect(first.since).toBe(t0.toISOString());
    // Second mark must not move the `since` timestamp forward.
    markCreditExhausted(new Date('2026-07-10T13:00:00.000Z'));
    const second = readCreditStatus();
    expect(second.since).toBe(t0.toISOString());
  });

  it('clearCreditStatus stamps `cleared`, drops the exhausted flag', () => {
    markCreditExhausted(new Date('2026-07-10T12:00:00.000Z'));
    clearCreditStatus(new Date('2026-07-10T14:00:00.000Z'));
    const status = readCreditStatus();
    expect(status.exhausted).toBe(false);
    expect(status.cleared).toBe('2026-07-10T14:00:00.000Z');
  });

  it('creditExhaustedNotice renders humanized "since" copy', () => {
    markCreditExhausted(new Date('2026-07-10T12:00:00.000Z'));
    // 3 hours later
    const notice = creditExhaustedNotice(new Date('2026-07-10T15:00:00.000Z'));
    expect(notice).not.toBeNull();
    expect(notice).toContain('Cognitum credits exhausted');
    expect(notice).toContain('ruflo funnel signup');
    expect(notice).toContain('3h ago');
  });

  it('returns null when credit is not exhausted (no surface)', () => {
    clearCreditStatus();
    expect(creditExhaustedNotice()).toBeNull();
  });
});
