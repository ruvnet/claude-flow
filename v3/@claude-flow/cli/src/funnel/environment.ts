/**
 * Environment gates for funnel surfaces (ADR-301/302).
 *
 * CI and non-interactive environments never see funnel content; reduced
 * motion / screen readers get static text only (which is all the funnel
 * renders anyway — there is deliberately no animation path in this module).
 */

const CI_ENV_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'BUILDKITE',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'TF_BUILD', // Azure Pipelines
];

export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  return CI_ENV_VARS.some((v) => {
    const val = env[v];
    return val !== undefined && val !== '' && val !== '0' && val.toLowerCase?.() !== 'false';
  });
}

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/**
 * Statusline invocations are spawned by an interactive host (Claude Code)
 * with piped stdio, so isTTY is false there even though the session is
 * interactive. Surfaces pass their own interactivity signal; this helper is
 * the strict check used by directly-invoked prompts (init enrollment).
 */
export function reducedMotion(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.NO_COLOR !== undefined ||
    env.RUFLO_REDUCED_MOTION === '1' ||
    env.TERM === 'dumb'
  );
}
