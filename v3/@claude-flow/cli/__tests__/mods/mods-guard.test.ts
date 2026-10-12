/**
 * ADR-404 — the mod's `tool.check` only tightens. These tests hold that over
 * every chain verdict, the fail-closed paths, ruflo policy modes, and parity
 * with the real policy evaluator and hook-handler.cjs pre-bash list.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ruleMatches as engineRuleMatches, type PolicyRule, type PolicyRequest } from '@claude-flow/security';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { DANGEROUS_COMMANDS, dangerousCommandVerdict } from '../../../../../plugins/ruflo-mods/hooks/guard/dangerous-command';
import { parseProjection, ruleMatches, toolRequest, type ProjectedRule } from '../../../../../plugins/ruflo-mods/hooks/guard/policy';
import { stricter } from '../../../../../plugins/ruflo-mods/hooks/guard/verdict';
import { loadMod, memoryWorld, type World } from './harness';
import { generateHookHandler } from '../../src/init/helpers-generator';

const HELPERS = join(resolve(__dirname, '../..'), '.claude', 'helpers');
const PROJECTION = '/work/.claude-flow/policy/claude-code.json';
const RANK = { allow: 0, ask: 1, deny: 2 } as const;
type D = keyof typeof RANK;

async function started(world: World) {
  const mod = loadMod(register, world);
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}

function withProjection(world: World, mode: string, rules: unknown[]) {
  (world.files as Map<string, { text: string; mtimeMs: number }>).set(PROJECTION, {
    text: JSON.stringify({ version: 1, mode, generatedAt: 1, rules }),
    mtimeMs: Date.now() + Math.random(),
  });
}

const check = (mod: Awaited<ReturnType<typeof started>>, tool: string, input: unknown, chain: { decision: D; reason?: string; rule?: string }) =>
  mod.dispatch('tool.check', { tool, input, tool_use_id: 't1' }, () => chain);

const DENY_BASH_RULE = { id: 'no-push', effect: 'deny', actions: ['claude-code.tool.Bash'], resources: ['git push*'] };
const ASK_EDIT_RULE = { id: 'review-edits', effect: 'require_approval', actions: ['claude-code.tool.Edit'] };

describe('ADR-404 tool.check never loosens', () => {
  const calls: Array<[string, unknown]> = [
    ['Bash', { command: 'ls' }],
    ['Bash', { command: 'rm -rf /' }],
    ['Bash', { command: 'git push origin main' }],
    ['Edit', { file_path: '/work/a.ts' }],
    ['Read', { file_path: '/work/a.ts' }],
    ['Bash', null],
    ['Bash', { command: 42 }],
  ];
  const chains = [
    { decision: 'allow' as D },
    { decision: 'ask' as D, reason: 'mode asks' },
    { decision: 'deny' as D, reason: 'Bash(rm:*)', rule: 'Bash(rm:*)' },
  ];

  for (const mode of ['legacy', 'observe', 'enforce', 'absent', 'garbage']) {
    it(`in policy mode ${mode}, for every call and chain verdict`, async () => {
      const world = memoryWorld();
      if (mode === 'garbage') (world.files as Map<string, any>).set(PROJECTION, { text: '{not json', mtimeMs: 1 });
      else if (mode !== 'absent') withProjection(world, mode, [DENY_BASH_RULE, ASK_EDIT_RULE]);
      const mod = await started(world);
      for (const [tool, input] of calls) {
        for (const chain of chains) {
          const out = await check(mod, tool, input, chain);
          expect(RANK[out.decision as D]).toBeGreaterThanOrEqual(RANK[chain.decision]);
          // Never rewritten: where ruflo does not tighten, the chain's own object (rule and all) stands.
          if (RANK[out.decision as D] === RANK[chain.decision]) expect(out).toBe(chain);
        }
      }
    });
  }

  it('stricter() keeps the chain object on ties and lets nothing loosen', () => {
    const chain = { decision: 'deny' as const, rule: 'Read(.env)' };
    expect(stricter(chain, { decision: 'allow' })).toBe(chain);
    expect(stricter(chain, { decision: 'ask' })).toBe(chain);
    expect(stricter(chain, { decision: 'deny', reason: 'ours' })).toBe(chain);
    expect(stricter({ decision: 'allow' }, undefined)).toEqual({ decision: 'allow' });
  });
});

describe('ADR-404 ruflo verdicts', () => {
  it('blocks the pre-bash list whatever the policy', async () => {
    const mod = await started(memoryWorld());
    const out = await check(mod, 'Bash', { command: 'sudo RM -RF / --no-preserve-root' }, { decision: 'allow' });
    expect(out).toMatchObject({ decision: 'deny' });
    expect(out.reason).toContain('rm -rf /');
  });

  it('enforce: a deny rule denies, an approval rule asks, an allow rule says nothing', async () => {
    const world = memoryWorld();
    withProjection(world, 'enforce', [DENY_BASH_RULE, ASK_EDIT_RULE, { id: 'all-read', effect: 'allow', actions: ['claude-code.tool.Read'] }]);
    const mod = await started(world);
    expect(await check(mod, 'Bash', { command: 'git push origin main' }, { decision: 'allow' })).toMatchObject({ decision: 'deny', reason: 'ruflo policy: denied-by:no-push' });
    expect(await check(mod, 'Edit', { file_path: 'x' }, { decision: 'allow' })).toMatchObject({ decision: 'ask' });
    const askChain = { decision: 'ask' as D };
    expect(await check(mod, 'Read', { file_path: 'x' }, askChain)).toBe(askChain);
  });

  it('enforce never applies the engine default-deny to a tool no rule names', async () => {
    const world = memoryWorld();
    withProjection(world, 'enforce', [DENY_BASH_RULE]);
    const mod = await started(world);
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'WebFetch', { url: 'https://x' }, chain)).toBe(chain);
  });

  it('observe logs what enforce would do and changes nothing', async () => {
    const world = memoryWorld();
    withProjection(world, 'observe', [DENY_BASH_RULE]);
    const mod = await started(world);
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'Bash', { command: 'git push' }, chain)).toBe(chain);
    expect(world.logs.join('\n')).toContain('denied-by:no-push');
  });

  it('a rule with no claude-code action (or only *) never reaches Claude Code tools', () => {
    const p = parseProjection(JSON.stringify({ version: 1, mode: 'enforce', rules: [
      { id: 'mcp', effect: 'deny', actions: ['mcp.tool.call'] },
      { id: 'star', effect: 'deny', actions: ['*'] },
      { id: 'cc', effect: 'deny', actions: ['claude-code.tool.*'] },
    ] }));
    expect(p.rules.map((r) => r.id)).toEqual(['cc']);
  });

  it('fails closed by one step on a projection that exists but cannot be read', async () => {
    for (const text of ['{not json', JSON.stringify({ version: 2, mode: 'enforce', rules: [] }), JSON.stringify({ version: 1, mode: 'enforce', rules: [{ id: 1 }] })]) {
      const world = memoryWorld();
      (world.files as Map<string, any>).set(PROJECTION, { text, mtimeMs: 1 });
      const mod = await started(world);
      expect(await check(mod, 'Read', { file_path: 'x' }, { decision: 'allow' })).toMatchObject({ decision: 'ask' });
      const deny = { decision: 'deny' as D, rule: 'r' };
      expect(await check(mod, 'Read', { file_path: 'x' }, deny)).toBe(deny);
    }
  });

  it('a refused ui.log is swallowed: observe still changes nothing', async () => {
    const world = memoryWorld();
    withProjection(world, 'observe', [DENY_BASH_RULE]);
    world.failLog = true;
    const mod = await started(world);
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'Bash', { command: 'git push' }, chain)).toBe(chain);
  });

  it('when the world beneath fails, the catch answers ask: ruflo could not judge', async () => {
    const mod = await started(memoryWorld());
    const out = await mod.dispatch('tool.check', { tool: 'Read', input: {}, tool_use_id: 'x' }, () => {
      throw new Error('engine verdict failed');
    });
    expect(out).toMatchObject({ decision: 'ask' });
  });

  it('an absent projection is no policy, not a failure', async () => {
    const mod = await started(memoryWorld());
    const chain = { decision: 'allow' as D };
    expect(await check(mod, 'Edit', { file_path: 'x' }, chain)).toBe(chain);
  });
});

describe('ADR-404 parity', () => {
  it('carries hook-handler.cjs pre-bash list exactly', () => {
    const source = readFileSync(join(HELPERS, 'hook-handler.cjs'), 'utf8');
    const literal = source.match(/const dangerous = (\[[^\]]*\]);/)?.[1];
    expect(literal).toBeDefined();
    expect(new Function(`return ${literal}`)()).toEqual(DANGEROUS_COMMANDS);
  });

  it('ruleMatches agrees with @claude-flow/security on every rule × request', () => {
    const rules: ProjectedRule[] = [];
    const actionsSet = [['claude-code.tool.Bash'], ['claude-code.tool.*'], ['claude-code.*', 'mcp.tool.call'], ['claude-code.tool.Edit']];
    const optional = {
      resources: [undefined, ['git push*'], ['/work/*'], ['*']],
      principals: [undefined, ['claude-code'], ['someone-else']],
      identityTypes: [undefined, ['agent'], ['user']],
      roles: [undefined, ['admin']],
      environments: [undefined, ['prod']],
      constraints: [undefined, { destructive: false }, { network: false }, { maxCostUsd: 1 }, { requireSignedEvidence: true }, { requiredProvenance: ['tool_result'] }, { allowedNamespaces: ['x'] }, { destructive: true }],
      enabled: [undefined, false],
    };
    let i = 0;
    for (const actions of actionsSet) for (const resources of optional.resources) for (const principals of optional.principals)
      for (const identityTypes of optional.identityTypes) for (const constraints of optional.constraints) for (const enabled of optional.enabled) {
        rules.push({ id: `r${i++}`, effect: 'deny', actions, resources, principals, identityTypes: identityTypes as any, constraints, enabled,
          ...(i % 3 === 0 ? { roles: ['admin'] } : {}), ...(i % 5 === 0 ? { environments: ['prod'] } : {}) });
      }
    const calls: Array<[string, unknown]> = [['Bash', { command: 'git push origin' }], ['Bash', { command: 'ls' }], ['Edit', { file_path: '/work/a.ts' }],
      ['WebFetch', { url: 'https://e' }], ['Read', {}], ['mcp__x__y', {}]];
    let compared = 0;
    for (const [tool, input] of calls) {
      const req = toolRequest(tool, input);
      const engineReq: PolicyRequest = { identity: { ...req.identity, roles: undefined } as PolicyRequest['identity'], action: { ...req.action }, context: {} };
      for (const rule of rules) {
        expect(ruleMatches(rule, req), `${rule.id} ${tool}`).toBe(engineRuleMatches(rule as unknown as PolicyRule, engineReq));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });
});

describe('#3698 root deletion guard parity', () => {
  let project: string;
  let fallback: string;
  const helpers = [
    join(HELPERS, 'hook-handler.cjs'),
    resolve(HELPERS, '../../../../../.claude/helpers/hook-handler.cjs'),
  ];
  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'ruflo-root-guard-'));
    fallback = join(project, 'hook-handler.cjs');
    writeFileSync(fallback, generateHookHandler());
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  // Only hook helpers run. These command strings are inert stdin JSON data.
  const cases: Array<[string, boolean]> = [
    ['rm -rf /tmp/ruflo-test', false],
    ['rm -rf /var/tmp/ruflo-test', false],
    ['sudo RM -RF /tmp/ruflo-test', false],
    ['rm -rf "/tmp/ruflo test"', false],
    ["rm -rf '/tmp/ruflo-test'", false],
    ['rm -rf /tmp/*', false],
    ['rm -rf /tmp/""', false],
    ["rm -rf /tmp/''", false],
    ['rm -rf "/tmp"/"ruflo test"', false],
    ['rm -rf /tmp/scratch/../test', false],
    ['rm -rf "/tmp;folder"', false],
    ['rm -rf /tmp/ruflo-test; printf /', false],
    ['rm -rf /tmp/ruflo-test && printf /', false],
    ['rm -rf /tmp/ruflo-test & printf /', false],
    ['rm -rf /tmp 2>&1 & printf /', false],
    ['rm -rf /tmp 2>&1 && printf /', false],
    ['rm -rf /tmp &>/dev/null && printf /', false],
    ['rm -rf /tmp > /tmp/log & printf /', false],
    ['rm -rf /tmp \\> & printf /', false],
    ['rm -rf /tmp/ruflo-test\nprintf /', false],
    ['rm -rf ./temporary', false],
    ['rm -rf /tmp/ruflo-test # ignored /', false],
    ['sh -c "rm -rf /tmp/ruflo-test"', false],
    ['rm -rf /', true],
    ['rm -rf /"" --no-preserve-root', true],
    ["rm -rf /'' --no-preserve-root", true],
    ['rm -rf /""*', true],
    ["rm -rf /''*", true],
    ['rm -rf ""/""', true],
    ["rm -rf ''/''", true],
    ['rm -rf "/""/"', true],
    ["rm -rf '/'\"\"'/'", true],
    ['rm -rf /\\\n --no-preserve-root', true],
    ['rm -rf /\\\n*', true],
    ['rm -rf "/\\\n"*', true],
    ['rm -rf /tmp/../ --no-preserve-root', true],
    ['rm -rf /tmp/../*', true],
    ['rm -rf /tmp/nested/../../', true],
    ['rm -rf "/tmp"/../*', true],
    ['rm -rf /tmp/../""*', true],
    ['rm -rf /tmp > /tmp/log /', true],
    ['rm -rf /tmp 2>&1 / --no-preserve-root', true],
    ['rm -rf /tmp &>/dev/null / --no-preserve-root', true],
    ['rm -rf /tmp 1>/tmp/log 2>&1 / --no-preserve-root', true],
    ['rm -rf /tmp &>>/dev/null / --no-preserve-root', true],
    ['rm -rf /tmp 0<&0 / --no-preserve-root', true],
    ['rm -rf "/tmp;folder" /', true],
    ['sh -c "rm -rf /"', true],
    ["sh -c 'rm -rf /'", true],
    ["sh -c \"echo 'rm -rf /tmp'; rm -rf /\"", true],
    ['sudo RM -RF / --no-preserve-root', true],
    ['/bin/rm -rf /', true],
    ['rm -rf --no-preserve-root /', true],
    ['rm -rf /tmp/ruflo-test /', true],
    ['rm -rf /tmp/ruflo-test; rm -rf /', true],
    ['rm -rf //', true],
    ['rm -rf /./', true],
    ['rm -rf /../', true],
    ['rm -rf "/"', true],
    ["rm -rf '/'", true],
    ['rm -fr /', true],
    ['rm -r -f /', true],
    ['rm --recursive --force /', true],
    ['rm -rf /*', true],
    ['rm -rf /.*', true],
    ['rm -rf /**', true],
    ['rm -rf /[a-z]*', true],
    ['rm -rf /;printf ok', true],
    ['rm -rf /&&printf ok', true],
    ['rm -rf /||printf ok', true],
    ['rm -rf /|cat', true],
    ['(rm -rf /)', true],
    ['rm -rf /\nprintf ok', true],
    // Command substitution, ANSI-C/locale quoting and GNU long-option prefixes.
    ['echo `date` /', false],
    ['rm --r /tmp/ruflo-test /', false],
    ['rm --forc /tmp/ruflo-test /', false],
    ["rm --rec --forc '/tmp/ruflo test'", false],
    ["printf $'rm -rf /tmp\\n'", false],
    ['echo `rm -rf /`', true],
    ['echo "`rm -rf /`"', true],
    ['bash -c "echo `rm -rf /`"', true],
    ['`rm -rf /`', true],
    ["$'rm' -rf /", true],
    ['$"rm" -rf /', true],
    ["bash -c $'rm -rf /'", true],
    ['rm --r --f /', true],
    ['rm --recur --forc /*', true],
    ['rm --rec -f /', true],
    // An empty substitution among rm's operands is dropped by the shell: rm keeps its state.
    ['rm -rf `true` /', true],
    ['rm `` -rf /', true],
    ['rm -rf /tmp/x `:` /', true],
    ['rm -r `:` -f /', true],
    ['git commit -m "fix `rm` docs"', false],
    // A substitution body is unescaped as bash does it, and one inside double quotes is a substitution too.
    ['echo `rm -rf \\( /`', true],
    ['echo `rm -rf \\\n/`', true],
    ['rm -rf "/`true`"', true],
    ['echo "`r\\`\\`m -rf /`"', true],
    ["sh -c 'r``m -rf /'", true],
    ['echo "`date`" /tmp', false],
    // A # right after a substitution is part of the word, not a comment; an unterminated backtick is text.
    ['`true`#x; rm -rf /', true],
    ['echo a`true`#b; rm -rf /', true],
    ['echo it` costs; rm -rf /', true],
    ['echo "a ` b"; rm -rf /', true],
    ['echo "a ` b"; ls /', false],
    // A quoted empty substitution glued to a flag leaves the flag; a # after one inside sh -c stays in the word.
    ['\\rm "`true`"--recursive --force /', true],
    ['rm "`true`"-rf /*', true],
    ['bash -c "`true`#x; rm -rf /"', true],
    ['echo `ls` /tmp', false],
    // #3791 adversarial table. Wrappers and flag spellings that still run rm on the root.
    ['command rm -rf /', true],
    ['env rm -rf /', true],
    ['sudo rm -rf /', true],
    ['sudo -u root rm -rf /', true],
    ['nice -n 5 rm -rf /', true],
    ['\\rm -rf /', true],
    ['rm -Rf /', true],
    ['rm -rfv /', true],
    ['rm -vrf /', true],
    ['rm -f -r /', true],
    ['rm -rf -- /', true],
    ['rm -rf -v /', true],
    ['rm --recursive -f /', true],
    ['rm -r --force /', true],
    ['rm --recurs --forc /', true],
    ['rm --recursiv --force /*', true],
    ['rm -r --f /', true],
    ["'rm' -rf /", true],
    ['r\\m -rf /', true],
    ['"r"m -rf /', true],
    ['$"rm" --r --f /', true],
    ['echo $(rm -rf /)', true],
    ['echo `rm --r --f /`', true],
    ['cd /tmp && echo "$(date)" `rm -rf /`', true],
    ["eval 'rm -rf /'", true],
    ['true; rm -rf /', true],
    ['false || rm -rf /', true],
    // Benign look-alikes that must not trip the guard.
    ['echo `date` /tmp', false],
    ['echo `date`', false],
    ['rm --r /tmp/x /', false],
    ['rm --rec /tmp/x /', false],
    ['rm -r /tmp/x /', false],
    ['rm -f /', false],
    ['rm /', false],
    ['rm --force --verbose /', false],
    ['rm --recursive /tmp/ruflo-test', false],
    ['rm -rf /tmp/ruflo-test', false],
    ['rm -rf ./build ../dist node_modules', false],
    ['rm -rf ~/scratch', false],
    ['rm -rf /home/user/project', false],
    ['rm -rf /var/tmp/x/../y', false],
    ['rmdir /', false],
    ['farm -rf /', false],
    ['alarm -rf /', false],
    ['rm-tool -rf /', false],
    ['git rm -r --cached /tmp/x', false],
    ['ls -rf /', false],
    ['printf "%s" `date` > /tmp/x; ls /', false],
    // Documented limits: nothing is evaluated (variables, brace expansion, find), so these are not caught.
    ['rm -rf "$HOME"', false],
    ['rm -rf ${HOME}/..', false],
    ['rm -rf $x', false],
    ['rm -rf /${x}', false],
    ['find / -delete', false],
    // $'...' is decoded as bash does: escapes stand for the characters they name, \0 ends the string, \' does not close it.
    ["rm -rf $'/'", true],
    ["rm -rf $'\\x2f'", true],
    ["rm -rf $'\\X2F'", true],
    ["rm -rf $'\\057'", true],
    ["rm -rf $'\\u002f'", true],
    ["rm -rf $'\\U0000002f'", true],
    ["$'\\x72m' -rf /", true],
    ["rm $'\\x2drf' /", true],
    ["rm -rf $'/\\x00etc'", true],
    ["rm -rf $'/\\0etc'", true],
    ["bash -c $'rm -rf \\x2f'", true],
    ["bash -c $'echo hi\\nrm -rf /'", true],
    ["echo $'\\'' ; rm -rf / ; echo $'\\''", true],
    ["echo $'a\\\\' ; rm -rf /", true],
    ["rm -rf $'\\x2ftmp'", false],
    ["rm -rf $'/'tmp", false],
    ["rm -rf $'/tmp'", false],
    ['rm -rf "$\'/\'"', false],
    ["rm -rf '$'/", false],
    ["echo $'\\x2f'", false],
    ["ls $'\\x2f'", false],
    ["echo $'\\'' /tmp", false],
    ["echo $'\\\\'; ls /", false],
    ["rm -rf $'\\\\' /tmp", false],
    ["rm -r $'\\x2d' /tmp", false],
    ['echo "$"\'rm -rf /\'', false],
    // Brace expansion is not evaluated either (documented limit).
    ['{rm,-rf,/}', false],
    ['rm -rf /{tmp,}', false],
    ['format c: /q /y', true],
    ['del /s /q c:\\', true],
    [':(){:|:&};:', true],
  ];
  function expectParity(command: string, denied: boolean) {
    expect(dangerousCommandVerdict('Bash', { command })?.decision === 'deny').toBe(denied);
    for (const helper of [...helpers, fallback]) {
      const result = spawnSync(process.execPath, [helper, 'pre-bash'], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
        cwd: project, encoding: 'utf8', timeout: 10_000,
        env: { PATH: process.env.PATH, HOME: project, CI: '1', RUFLO_MODS_OWNS: 'route,post-edit,pre-bash' },
      });
      expect(result.error, helper).toBeUndefined();
      expect(result.status, `${helper}: ${result.stderr}`).toBe(denied ? 2 : 0);
      expect(denied ? result.stderr : result.stdout).toContain(denied ? '[BLOCKED]' : '[OK] Command validated');
    }
  }
  it.each(cases)('%j: denied=%s in mod, shipped helpers and fallback', expectParity);

  it('scans a 60 KB safe cleanup input without losing classic/fallback parity', () => {
    expectParity('rm -rf /tmp '.repeat(5000), false);
  });
});
