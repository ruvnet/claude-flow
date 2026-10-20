/** `npx skills find react` as skills 1.7.0 printed it on this machine: 256-colour names, cyan counts, a └ url line. */
export const FIND_OUT = [
  '',
  '\u001b[38;5;102mInstall with\u001b[0m npx skills add <owner/repo@skill>',
  '',
  '\u001b[38;5;145mmattpocock/skills@tdd\u001b[0m \u001b[36m1M installs\u001b[0m',
  '\u001b[38;5;102m└ https://skills.sh/mattpocock/skills/tdd\u001b[0m',
  '',
  '\u001b[38;5;145mvercel-labs/agent-skills@vercel-react-best-practices\u001b[0m \u001b[36m764.8K installs\u001b[0m',
  '\u001b[38;5;102m└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices\u001b[0m',
  '',
  '\u001b[38;5;145mopen.feishu.cn@lark-event\u001b[0m \u001b[36m740.2K installs\u001b[0m',
  '\u001b[38;5;102m└ https://skills.sh/open.feishu.cn/lark-event\u001b[0m',
  '',
  '\u001b[38;5;145msomeone/repo@fresh\u001b[0m',
  '\u001b[38;5;102m└ https://skills.sh/someone/repo/fresh\u001b[0m',
  '',
].join('\n')

/** `npx skills ls -g --json`, the shape runList prints (one entry from this machine, one made up). */
export const LS_GLOBAL = JSON.stringify([
  {
    name: 'faceless-explainer',
    path: '/home/dev/.agents/skills/faceless-explainer',
    scope: 'global',
    agents: ['Claude Code', 'Codex'],
    source: 'heygen-com/hyperframes',
    sourceUrl: 'https://github.com/heygen-com/hyperframes.git',
    sourceType: 'github',
  },
  { name: 'tdd', path: '/home/dev/.agents/skills/tdd', scope: 'global', agents: [], source: null, sourceUrl: null, sourceType: null },
])

/**
 * `npx skills add vercel-labs/agent-skills@vercel-react-best-practices --list` as skills 1.7.0 printed it on this
 * machine (clack's │ gutter, a name at four spaces, its description at six), spinner frames cut to one.
 */
export const LIST_OUT = [
  '',
  '\u001b[90m│\u001b[39m',
  '\u001b[32m◇\u001b[39m  Source: https://github.com/vercel-labs/agent-skills.git \u001b[2m@\u001b[22m\u001b[36mvercel-react-best-practices\u001b[39m',
  '\u001b[?25l\u001b[90m│\u001b[39m',
  '\u001b[35m◒\u001b[39m  Fetching skills…\u001b[1G\u001b[J\u001b[32m◇\u001b[39m  Found \u001b[32m1\u001b[39m skill',
  '\u001b[?25h',
  '\u001b[90m│\u001b[39m',
  '\u001b[32m◇\u001b[39m  \u001b[1mAvailable Skills\u001b[22m',
  '\u001b[90m│\u001b[39m',
  '\u001b[90m│\u001b[39m    \u001b[36mvercel-react-best-practices\u001b[39m',
  '\u001b[90m│\u001b[39m',
  '\u001b[90m│\u001b[39m      \u001b[2mReact and Next.js performance optimization guidelines from Vercel Engineering.\u001b[22m',
  '',
  '\u001b[90m│\u001b[39m',
  '\u001b[90m└\u001b[39m  Use --skill <name> to install specific skills',
  '',
].join('\n')

/** The head of what `npx skills use vercel-labs/agent-skills@vercel-react-best-practices` printed: the prompt only. */
export const USE_OUT = [
  "You are being given a Skill to execute for the user's next request.",
  '',
  'Use the following SKILL.md as your instructions:',
  '',
  '<SKILL.md>',
  '---',
  'name: vercel-react-best-practices',
  'description: React and Next.js performance optimization guidelines from Vercel Engineering.',
  '---',
  '',
  '# Vercel React Best Practices',
  '</SKILL.md>',
  '',
].join('\n')
