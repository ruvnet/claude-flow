export type McpServerEntry = { name: string; url: string; headers?: Record<string, string> };

/**
 * Merge request-provided MCP servers over the env-configured base servers, by name.
 *
 * The request wins, but `/api/mcp/servers` deliberately withholds base-server headers
 * from the browser, so the copy the client echoes back has none. Replacing the base
 * entry wholesale would drop its server-side credentials (e.g. `Authorization`), and
 * every tool listing from the chat UI would then fail with 401 (#2901).
 *
 * So a request entry that carries no headers of its own keeps the base entry's
 * headers, but only when it points at the same URL: a request must not be able to
 * redirect a server-side token to another host by reusing a base server's name.
 */
export function mergeMcpServers(
	base: McpServerEntry[],
	custom: McpServerEntry[]
): McpServerEntry[] {
	const byName = new Map<string, McpServerEntry>();
	for (const s of base) byName.set(s.name, s);
	for (const s of custom) {
		const existing = byName.get(s.name);
		const hasOwnHeaders = !!s.headers && Object.keys(s.headers).length > 0;
		if (!hasOwnHeaders && existing?.headers && existing.url === s.url) {
			byName.set(s.name, { ...s, headers: existing.headers });
		} else {
			byName.set(s.name, s);
		}
	}
	return [...byName.values()];
}
