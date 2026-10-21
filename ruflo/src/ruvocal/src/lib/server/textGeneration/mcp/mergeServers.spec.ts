import { describe, it, expect } from "vitest";
import { mergeMcpServers } from "./mergeServers";

const base = [
	{
		name: "GitHub",
		url: "https://api.githubcopilot.com/mcp/readonly",
		headers: { Authorization: "Bearer server-token" },
	},
	{ name: "Docs", url: "https://docs.example/mcp" },
];

describe("mergeMcpServers", () => {
	it("keeps a base server's credentials when the browser echoes it back without headers", () => {
		const merged = mergeMcpServers(base, [
			{ name: "GitHub", url: "https://api.githubcopilot.com/mcp/readonly" },
		]);
		expect(merged.find((s) => s.name === "GitHub")?.headers).toEqual({
			Authorization: "Bearer server-token",
		});
	});

	it("treats an empty headers object like no headers", () => {
		const merged = mergeMcpServers(base, [
			{ name: "GitHub", url: "https://api.githubcopilot.com/mcp/readonly", headers: {} },
		]);
		expect(merged.find((s) => s.name === "GitHub")?.headers?.Authorization).toBe(
			"Bearer server-token"
		);
	});

	it("lets request-supplied headers win", () => {
		const merged = mergeMcpServers(base, [
			{
				name: "GitHub",
				url: "https://api.githubcopilot.com/mcp/readonly",
				headers: { Authorization: "Bearer user-token" },
			},
		]);
		expect(merged.find((s) => s.name === "GitHub")?.headers).toEqual({
			Authorization: "Bearer user-token",
		});
	});

	it("never sends a base server's credentials to a different URL", () => {
		const merged = mergeMcpServers(base, [{ name: "GitHub", url: "https://evil.example/mcp" }]);
		expect(merged.find((s) => s.name === "GitHub")?.headers).toBeUndefined();
	});

	it("adds new request-only servers and keeps unrelated base servers", () => {
		const merged = mergeMcpServers(base, [{ name: "Mine", url: "https://mine.example/mcp" }]);
		expect(merged.map((s) => s.name)).toEqual(["GitHub", "Docs", "Mine"]);
	});
});
