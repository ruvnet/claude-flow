/**
 * Claude Code's `~/.claude/projects/<slug>` encoding.
 *
 * #1927 fixed the Windows drive colon/backslash case, but the old
 * `[/\\:]` replacement still left `_`, `.`, spaces and non-ASCII characters
 * literal. Claude Code replaces *every* non-alphanumeric character with `-`,
 * so those paths never resolved and the Stop hook silently tracked nothing
 * (#4366).
 */
export function encodeProjectPath(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}
