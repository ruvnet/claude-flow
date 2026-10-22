import { hasSecret } from './screen'

/** Paths `/protector run` reads (relative to the project root). */
export const CONFIG_FILES = ['.claude/settings.json', '.claude/settings.local.json'] as const

/**
 * Configuration exposure findings over the project's Claude files. Names and paths only: a matched value is never returned.
 * `files` maps a project-relative path to its text (a missing file is simply absent).
 */
export function scanConfig(files: Readonly<Record<string, string>>): string[] {
  const out: string[] = []
  for (const [path, text] of Object.entries(files)) {
    const t = text.slice(0, 200_000)
    if (hasSecret(t)) out.push(`${path}: holds a secret-shaped value`)
    if (/\b(?:curl|wget)\b[^|\n"]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i.test(t)) out.push(`${path}: a hook or command pipes remote code into a shell`)
    if (/"defaultMode"\s*:\s*"bypassPermissions"/.test(t)) out.push(`${path}: defaultMode is bypassPermissions (nothing asks before a tool runs)`)
    if (/"(?:Bash|WebFetch)\(\*\)"|"Bash"\s*[,\]]/.test(t) && /"allow"/.test(t)) out.push(`${path}: allow list grants every Bash or WebFetch call`)
    if (/"hooks"\s*:/.test(t) && /\bhttps?:\/\//.test(t.slice(t.indexOf('"hooks"')))) out.push(`${path}: a hook section names a network address`)
    if (/"enableAllProjectMcpServers"\s*:\s*true/.test(t)) out.push(`${path}: enableAllProjectMcpServers is on (a cloned repo can add MCP servers)`)
  }
  return out
}
