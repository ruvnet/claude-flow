import { hasRootDelete } from './rootdelete'
import { hasSecret, INJECTION, textsOf } from './screen'

/** What an event is, as a closed set of tokens. No argument value, file content or prompt text ever sits in one. */
export type Risk = 'read' | 'write' | 'exec' | 'net' | 'spawn' | 'other'
export type Flag = 'secret' | 'pipe-shell' | 'persist' | 'cred-read' | 'destroy' | 'dep-url' | 'sysprompt' | 'override' | 'escalate' | 'body'

export type Ev = {
  readonly k: 'tool' | 'spawn' | 'recv'
  readonly tool: string
  readonly head: string
  readonly heads: readonly string[]
  readonly host: string
  readonly areas: readonly string[]
  readonly risk: Risk
  readonly flags: readonly Flag[]
  tainted: boolean
  at: number
}

/** Local setup commands that touch Claude configuration by design: matched whole (exact argv), never by prefix. */
export const EXEMPT_ARGV: readonly string[] = [
  'npx ruflo init', 'npx ruflo@latest init', 'npx claude-flow init', 'npx @claude-flow/cli@latest init', 'npx @claude-flow/cli@latest init --wizard',
  'npx @claude-flow/cli@latest doctor --fix', 'npx @claude-flow/cli@latest daemon start', 'claude mcp add claude-flow -- npx -y @claude-flow/cli@latest',
]

const SUBCMD = new Set(['git', 'npm', 'npx', 'cargo', 'docker', 'kubectl', 'gh', 'pnpm', 'yarn', 'pip', 'pip3', 'go', 'gcloud', 'systemctl', 'claude'])
const NET_HEADS = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'telnet', 'socat', 'scp', 'sftp', 'ftp', 'http', 'xh'])
const WRAPPERS = new Set(['sudo', 'time', 'env', 'nohup', 'command', 'exec', 'nice', 'doas'])
const LOCAL_MCP = /ruflo|claude-flow|ruv-swarm|ruvector|ide|console|plugin_ruflo|rulake|ruos|agentdb/i
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const TAINT_TOOLS = new Set(['WebFetch', 'WebSearch'])

/** A token worth keeping: short, plain characters, and never a secret. Anything else is a coarse placeholder. */
export function token(t: string): string {
  if (t.length > 24 || !/^[A-Za-z0-9._+@-]+$/.test(t)) return 'other'
  return hasSecret(t) ? 'redacted' : t
}

const PERSIST_PATH = /(?:^|\/)(?:\.claude\/(?:settings[\w.-]*\.json|hooks\/|helpers\/)|\.claude-flow\/protector-mod\/(?:rules|allow)\.json|\.(?:bashrc|zshrc|profile|bash_profile|zprofile|zshenv)|\.ssh\/authorized_keys|\.git\/hooks\/|crontab)/
const CRED_PATH = /(?:^|\/)(?:\.ssh\/|\.aws\/|\.config\/gcloud|\.azure\/|\.gnupg\/|\.mozilla\/|\.config\/(?:google-chrome|chromium)|Library\/(?:Keychains|Application Support\/(?:Google|Firefox)))/
const WRITE_OP = /(?:>>?|\btee\b|\bsed\s+-i|\bcp\b|\bmv\b|\bln\s+-s|\bchmod\b|\binstall\b|\btruncate\b)/
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath'] as const

/** The registrable domain of a host, or a class word; never a path or a query. */
export function hostClass(host: string): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || /^127\./.test(h) || h.endsWith('.localhost')) return 'local'
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) return 'ip'
  const parts = h.split('.').filter(Boolean)
  if (parts.length < 2) return token(h)
  const tld = parts[parts.length - 1] as string
  const sld = parts[parts.length - 2] as string
  const take = tld.length === 2 && sld.length <= 3 && parts.length > 2 ? 3 : 2
  return token(parts.slice(-take).join('.'))
}

function hostsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b[a-z][a-z0-9+.-]{1,12}:\/\/(?:[^\s/@'"]+@)?(\[[0-9a-f:]+\]|[^\s/:'"?#]+)/gi)) out.push(hostClass(m[1] as string))
  return [...new Set(out)].slice(0, 4)
}

/** The heads of a shell command (first word and, for known tools, the subcommand) per simple command, at most six. */
export function headsOf(command: string): string[] {
  const out: string[] = []
  for (const seg of command.split(/&&|\|\||[;|\n]/).slice(0, 12)) {
    const words = seg.trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string) || WRAPPERS.has(words[i] as string))) i++
    const first = (words[i] ?? '').replace(/^.*\//, '')
    if (first === '') continue
    const head = token(first)
    const sub = SUBCMD.has(head) && /^[a-z][a-z-]{1,15}$/.test(words[i + 1] ?? '') ? ` ${words[i + 1]}` : ''
    out.push(head + sub)
    if (out.length >= 6) break
  }
  return out
}

/** The area of a path: the first two directory levels under the project root, or a coarse class outside it. Never a full path. */
export function areaOf(path: string, root: string): string {
  const base = root.replace(/\/+$/, '')
  if (path.startsWith('/') && base !== '' && path !== base && !path.startsWith(`${base}/`)) {
    if (/^\/tmp\b|^\/var\/tmp\b/.test(path)) return 'outside:tmp'
    if (/^\/etc\b/.test(path)) return 'outside:etc'
    if (/^\/(?:usr|opt|var|bin|sbin|lib\w*)\b/.test(path)) return 'outside:sys'
    return /^\/(?:home|Users|root)\b/.test(path) ? 'outside:home' : 'outside:other'
  }
  const rel = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path.replace(/^\.\//, '')
  const dirs = rel.split('/').slice(0, -1).slice(0, 2).map(d => (/^[A-Za-z0-9._-]{1,24}$/.test(d) && !hasSecret(d) ? d : '*'))
  return dirs.length === 0 ? '.' : dirs.join('/')
}

const inputOf = (input: unknown): Record<string, unknown> => (input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {})
const pathsOf = (i: Record<string, unknown>): string[] => PATH_KEYS.map(k => i[k]).filter((v): v is string => typeof v === 'string')

function bashFlags(command: string, root: string, flags: Set<Flag>, netHead: boolean) {
  const low = command.toLowerCase()
  const plain = !/[;&|<>`$()]/.test(command)
  const exempt = plain && EXEMPT_ARGV.includes(command.trim().replace(/\s+/g, ' '))
  if (/\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\bbase64\s+(?:-d|--decode)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b|\beval\s+["']?\$\(\s*(?:curl|wget)\b|\bpython3?\s+-c\b[^\n]{0,200}\b(?:urlopen|urllib|requests\.get)\b/.test(low)) flags.add('pipe-shell')
  const home = low.replace(/(?:~|\$\{?home\}?)(?=\/\*)/g, '').replace(/(^|[\s'"=])(?:~|\$\{?home\}?)\/?(?=[\s'";&|)]|$)/g, '$1/')
  const rooted = root === '' ? home : home.split(root.toLowerCase()).join('/')
  const forceMain = /\bgit\s+push\b[^;&|\n]*(?:--force\b|--force-with-lease\b|\s-[a-z]*f\b|\s\+)[^;&|\n]*\b(?:main|master|trunk)\b/.test(low)
  if (hasRootDelete(rooted) || forceMain || /\bdrop\s+(?:database|schema)\b/.test(low) || /\bmkfs(?:\.\w+)?\s|\bwipefs\b|\bdd\b[^;&|\n]*\bof=\/dev\/(?:sd|nvme|hd|vd|mmcblk|disk)|\bshred\b[^;&|\n]*\/dev\//.test(low)) flags.add('destroy')
  if (!exempt && (/\bcrontab\b(?!\s+-l)/.test(low) || (WRITE_OP.test(command) && PERSIST_PATH.test(command)))) flags.add('persist')
  if (CRED_PATH.test(command) && /\b(?:cat|less|more|head|tail|cp|tar|zip|grep|base64|xxd|strings|scp|rsync|openssl)\b/.test(low)) flags.add('cred-read')
  if (/\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b[^;&|\n]*(?:git\+|github:|\.tgz\b|https?:\/\/)|\bpip3?\s+install\b[^;&|\n]*(?:git\+|https?:\/\/|--(?:extra-)?index-url)|\bcargo\s+install\b[^;&|\n]*--git\b/.test(low)) flags.add('dep-url')
  if (netHead && /(?:^|\s)(?:-d|--data(?:-\w+)?|-F|--form|-T|--upload-file|--json|-X\s*(?:POST|PUT|PATCH))\b/.test(command)) flags.add('body')
}

/** Normalise one tool call into a categorical record; the only place raw input is read. */
export function normalise(tool: string, input: unknown, root: string, at: number): Ev {
  const i = inputOf(input)
  const flags = new Set<Flag>()
  let risk: Risk = 'other'
  let heads: string[] = []
  let host = ''
  const areas = new Set<string>()
  const mcp = tool.startsWith('mcp__')
  const server = mcp ? tool.slice(5, Math.max(5, tool.lastIndexOf('__'))) : ''
  const texts = textsOf(input)
  const command = typeof i.command === 'string' ? i.command : ''
  let net = false

  if (tool === 'Bash' || tool === 'PowerShell') {
    heads = headsOf(command)
    net = heads.some(h => NET_HEADS.has(h.split(' ')[0] as string))
    risk = net ? 'net' : 'exec'
    const found = hostsIn(command)
    host = found.find(h => h !== 'local') ?? found[0] ?? ''
    if (host === 'local' && net) risk = 'exec'
    bashFlags(command, root, flags, net)
  } else if (TAINT_TOOLS.has(tool)) {
    risk = 'net'
    net = true
    host = hostsIn(typeof i.url === 'string' ? i.url : '')[0] ?? ''
  } else if (WRITE_TOOLS.has(tool)) {
    risk = 'write'
    for (const p of pathsOf(i)) {
      areas.add(areaOf(p, root))
      if (PERSIST_PATH.test(p)) flags.add('persist')
    }
  } else if (READ_TOOLS.has(tool)) {
    risk = 'read'
    for (const p of pathsOf(i)) {
      areas.add(areaOf(p, root))
      if (CRED_PATH.test(p)) flags.add('cred-read')
    }
  } else if (mcp) {
    net = !LOCAL_MCP.test(server)
    risk = net ? 'net' : 'other'
    host = net ? token(server.replace(/^plugin_/, '').slice(0, 24)) : ''
  } else if (tool === 'SendMessage') {
    if (texts.some(t => INJECTION.some(([n, re]) => ['override instructions', 'role reassignment', 'fake role tags', 'concealment'].includes(n) && re.test(t.slice(0, 20_000))))) flags.add('override')
  }
  if (net && texts.some(hasSecret)) flags.add('secret')
  if (net && texts.some(t => /<system-reminder>|<\/?system>|You are Claude Code, Anthropic's|BEGIN SYSTEM PROMPT/i.test(t.slice(0, 50_000)))) flags.add('sysprompt')
  return { k: 'tool', tool: mcp ? `mcp:${token(server.slice(0, 24))}` : token(tool), head: heads[0] ?? '', heads, host, areas: [...areas].slice(0, 4), risk, flags: [...flags], tainted: false, at }
}

/** The tools whose results come from outside the trust boundary. */
export const isTaintSource = (tool: string, input: unknown): boolean =>
  TAINT_TOOLS.has(tool) || (tool.startsWith('mcp__') && !LOCAL_MCP.test(tool.slice(5))) || (READ_TOOLS.has(tool) && outsideOnly(input))

function outsideOnly(input: unknown): boolean {
  const ps = pathsOf(inputOf(input))
  return ps.length > 0 && ps.every(p => p.startsWith('/tmp/') || p.startsWith('/var/tmp/'))
}

export function spawnEv(type: string, permissionMode: string | undefined, at: number): Ev {
  const esc = permissionMode === 'bypassPermissions' || permissionMode === 'dontAsk'
  return { k: 'spawn', tool: 'Agent', head: token(type), heads: [], host: '', areas: [], risk: 'spawn', flags: esc ? ['escalate'] : [], tainted: false, at }
}

export const recvEv = (override: boolean, at: number): Ev => ({ k: 'recv', tool: 'recv', head: '', heads: [], host: '', areas: [], risk: 'other', flags: override ? ['override'] : [], tainted: false, at })
