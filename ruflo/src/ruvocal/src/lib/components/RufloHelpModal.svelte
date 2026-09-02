<script lang="ts">
	import Modal from "./Modal.svelte";
	import CarbonClose from "~icons/carbon/close";

	interface Props {
		onclose?: () => void;
	}

	let { onclose }: Props = $props();

	type Tool = { name: string; desc: string };
	type Group = { id: string; title: string; emoji: string; intro: string; tools: Tool[] };

	type ModelInfo = {
		name: string;
		provider: string;
		strength: string;
		notes: string;
		isDefault?: boolean;
	};

	const models: ModelInfo[] = [
		{
  			name: "Claude Sonnet 4.6",
  			provider: "Anthropic",
  			strength: "Best general reasoning + long-horizon work",
  			notes: "Default. Best default for complex workflows and multi-step MCP tasks.",
  			isDefault: true,
		},
		{
			name: "Claude Sonnet 4.6",
			provider: "Anthropic",
			strength: "Best general reasoning + long-horizon work",
			notes: "Reach for this on complex multi-step tasks or 6+ parallel tool calls.",
		},
		{
			name: "Gemini 2.5 Pro",
			provider: "Google",
			strength: "1M context, deep research synthesis",
			notes: "Strongest at multi-document analysis. Tool-calling is more cautious than Claude.",
		},
		{
			name: "Gemini 2.5 Flash",
			provider: "Google",
			strength: "Fast multimodal + grounded search",
			notes: "Good for image / PDF inputs. May skip tool calls when context grows.",
		},
		{
			name: "Qwen 3.6 Max",
			provider: "Alibaba",
			strength: "Open-weight flagship with strong code/math",
			notes: "262K context, competitive with closed frontier on code tasks.",
		},
		{
			name: "GPT-4o",
			provider: "OpenAI",
			strength: "Multimodal baseline",
			notes: "Familiar OpenAI behavior. Tool-calling is solid.",
		},
	];

	const groups: Group[] = [
		{
			id: "memory",
			title: "Memory & Knowledge",
			emoji: "🧠",
			intro: "Persistent cross-session memory backed by AgentDB (sql.js + HNSW vector index). Store anything by key, search by meaning, or list a namespace.",
			tools: [
				{ name: "ruflo__memory_store", desc: "Save a key/value into a namespace." },
				{ name: "ruflo__memory_search", desc: "Semantic vector search over stored memories." },
				{ name: "ruflo__memory_retrieve", desc: "Fetch a specific entry by key + namespace." },
				{ name: "ruflo__memory_list", desc: "List entries in a namespace." },
				{ name: "ruflo__embeddings_compare", desc: "Compare two pieces of text by semantic similarity." },
				{ name: "ruflo__agentdb_*", desc: "Lower-level AgentDB controllers (route, consolidate, hierarchical)." },
			],
		},
		{
			id: "agents",
			title: "Agents & Orchestration",
			emoji: "🤖",
			intro: "Spawn specialized agents, coordinate swarms with hierarchical / mesh / adaptive topologies, and run hive-mind consensus for fault-tolerant work.",
			tools: [
				{ name: "ruflo__agent_spawn", desc: "Create a new specialized agent (coder, tester, reviewer, security-auditor, …)." },
				{ name: "ruflo__swarm_init", desc: "Initialize a swarm with topology + strategy + max agents." },
				{ name: "ruflo__hive-mind_*", desc: "Queen-led Byzantine fault-tolerant collective." },
				{ name: "ruflo__task_create / task_assign / task_status", desc: "Full task lifecycle." },
				{ name: "ruflo__agent_list / agent_status", desc: "Inspect active agents and their state." },
			],
		},
		{
			id: "intelligence",
			title: "Intelligence & Learning",
			emoji: "✨",
			intro: "Pattern learning, model routing, code analysis, and trajectory tracking via RuVector. Tools here improve future task execution by recording what worked.",
			tools: [
				{ name: "ruvector__hooks_route", desc: "Pick the optimal agent type for a task." },
				{ name: "ruvector__hooks_remember / recall", desc: "Cross-session key/value memory shared with agents." },
				{ name: "ruvector__hooks_trajectory_begin / step / end", desc: "Record multi-step task execution so the system learns from the run." },
				{ name: "ruvector__hooks_security_scan", desc: "Scan code for vulnerabilities." },
				{ name: "ruvector__hooks_rag_context", desc: "Get retrieval-augmented context for a query." },
				{ name: "ruvector__hooks_swarm_recommend", desc: "Recommend swarm topology + agent mix for a task." },
			],
		},
		{
			id: "devtools",
			title: "Dev Tools & Analysis",
			emoji: "🛠️",
			intro: "System health, performance profiling, GitHub integration, code-review primitives, and shell access. The widest group at 73 tools.",
			tools: [
				{ name: "ruflo__system_status", desc: "Overall system health overview." },
				{ name: "ruflo__performance_metrics / bottleneck / report", desc: "Detailed performance and hotspot analysis." },
				{ name: "ruflo__analyze_diff*", desc: "Risk-score, classify, and suggest reviewers for a code diff." },
				{ name: "ruflo__github_repo_analyze / pr_manage / issue_track", desc: "Repository metrics and PR/issue ops." },
				{ name: "ruflo__terminal_execute / terminal_create", desc: "Run shell commands and manage sessions." },
				{ name: "ruflo__progress_*", desc: "Implementation progress tracking across long-horizon work." },
			],
		},
		{
			id: "core",
			title: "Core Tools",
			emoji: "⚡",
			intro: "Built-in tools always available regardless of MCP configuration. These three cover most knowledge questions before any specialized tool is needed.",
			tools: [
				{ name: "search", desc: "Search the local knowledge base for documents and how-tos." },
				{ name: "web_research", desc: "Web search, deep research, comparisons, fact-checking, and multi-step GOAP research." },
				{ name: "guidance", desc: "Get help on any tool group. Topics: overview, groups, agents, memory, intelligence, devtools, or a specific tool by name." },
			],
		},
		{
			id: "wasm",
			title: "WASM Gallery (Browser-side)",
			emoji: "🧩",
			intro: "In-browser MCP server (rvagent-wasm, ~588 KB) with persistent IndexedDB storage. Tools run locally — no server roundtrip, works offline. Available as MCP (1) in the chat input.",
			tools: [
				{ name: "WASM gallery", desc: "18 prebuilt templates exposed via the local WASM MCP server." },
				{ name: "Custom templates", desc: "Add your own via the MCP Servers panel → Add Server." },
				{ name: "Web Worker (opt-in)", desc: "Append ?worker=1 to the URL to run WASM MCP off the main thread." },
			],
		},
	];

	const tips = [
		"**MCP (n) pill** above the message box opens the server manager — toggle individual servers, add custom MCP endpoints, run health checks.",
		'**AUTO toggle**: green/lit means tool chains continue automatically. Gray means RuFlo stops after each tool result so you can inspect before continuing.',
		'**Parallel tool calls** — when your prompt implies multiple steps ("get system status AND list memory namespaces AND check performance"), the model emits all `tool_calls` in one response and they run via `Promise.all`. Watch for the "Step N — M tools completed" cards.',
		'**Memory just works** — say "remember my favorite color is indigo" and later "what color do I like?" — no explicit tool name needed.',
		'**Trajectory mode** — for long multi-step work, prefix with "Use `ruvector__hooks_trajectory_begin`" so the system learns from the run for future routing.',
		'**Tool name prefixes** — `ruflo__` is the agent/memory backend, `ruvector__` is the intelligence layer. Always use the full prefixed name when invoking explicitly.',
	];

	const examplePrompts = [
		'"Use ruflo__memory_store namespace=prefs key=editor value=vim then ruflo__memory_retrieve to confirm."',
		'"Run ruflo__system_status, ruflo__performance_metrics, and ruflo__memory_list in parallel and summarize."',
		'"Spawn a 5-agent hierarchical swarm (architect, coder, tester, reviewer, security-auditor) for a Python→TypeScript refactor."',
		'"Use ruvector__hooks_route on the task: add OAuth to a SvelteKit API. Then spawn the recommended agent."',
		'"Search RuFlo memory for prior decisions about authentication, then web_research recent OAuth2 best practices, in parallel."',
		'"Analyze the diff at github.com/ruvnet/ruflo/pull/1687 — risk score, classify, and suggest reviewers."',
	];

	const stack: { name: string; role: string }[] = [
		{ name: "SvelteKit + adapter-node", role: "UI runtime, SSR + streaming MCP responses" },
		{ name: "OpenRouter", role: "Single OAI-compatible endpoint, 6 models, smart fail-over" },
		{ name: "ruflo backend (npx ruflo mcp start)", role: "Agents, memory, swarm, devtools (~158 tools)" },
		{ name: "ruvector backend (npx ruvector mcp start)", role: "Intelligence, routing, trajectories (~49 tools)" },
		{ name: "AgentDB (sql.js + HNSW)", role: "Persistent memory, 384-dim ONNX embeddings, 150x–12 500x search speedup" },
		{ name: "rvagent-wasm (in-browser, ~588 KB)", role: "18-tool gallery with IndexedDB persistence, optional Web Worker" },
		{ name: "MongoDB (embedded)", role: "Conversation + session storage (ephemeral on Cloud Run cold starts today)" },
		{ name: "Cloud Run (us-central1)", role: "Both ruvocal chat-ui and mcp-bridge services with min-instance=1 warm" },
	];

	const domains: { url: string; note: string }[] = [
		{ url: "flo.ruv.io", note: "Primary — shortest URL, recommended" },
		{ url: "ruflo.ruv.io", note: "Brand alias" },
		{ url: "ruvocal.ruv.io", note: "Original alias (matches the upstream chat-ui fork name)" },
		{ url: "ruvocal-875130704813.us-central1.run.app", note: "Raw Cloud Run URL — always available, no DNS dependency" },
	];

	const shortcuts: { keys: string; action: string }[] = [
		{ keys: "Enter", action: "Send the current message" },
		{ keys: "Shift + Enter", action: "Insert a newline" },
		{ keys: "Esc", action: "Close any open modal" },
		{ keys: "?worker=1 (URL flag)", action: "Run WASM MCP off the main thread (experimental)" },
	];

	const cardLegend: { mark: string; meaning: string }[] = [
		{ mark: "✓ Called tool", meaning: "Tool returned successfully — click the row to expand the JSON result" },
		{ mark: "Step N — M tools completed", meaning: "Parallel batch indicator. M tools fired in one model turn via Promise.all" },
		{ mark: "Retry", meaning: "Last response had no content. Click to re-run with the same prompt and model" },
		{ mark: "AUTO (green)", meaning: "Autopilot ON — model auto-continues after each tool result" },
		{ mark: "AUTO (gray)", meaning: "Autopilot OFF — model stops after each tool result so you can inspect" },
	];

	let openGroup = $state<string | null>("memory");
</script>

<Modal width="max-w-3xl" closeButton={false} {onclose}>
	<div class="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
		<header class="flex items-start justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
			<div class="flex items-start gap-3">
				<span class="text-3xl leading-none">📘</span>
				<div>
					<h2 class="text-lg font-semibold">RuFlo Capabilities</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400">~210 MCP tools · 5 server groups · 18 in-browser WASM tools · 6 frontier models · parallel tool calling</p>
				</div>
			</div>
			<button
				type="button"
				onclick={() => onclose?.()}
				class="flex size-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
				aria-label="Close help"
			>
				<CarbonClose />
			</button>
		</header>

		<div class="flex-1 overflow-y-auto px-6 py-4">
			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Quick start</h3>
				<ol class="list-decimal space-y-1.5 pl-5 text-sm">
					<li>Pick a model below (default: <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">Claude Haiku 4.5</code>).</li>
					<li>Click an example prompt below the chat box, or type your own.</li>
					<li>RuFlo decides which tools to call. Watch the streaming tool-call cards below your message — multiple cards = parallel execution.</li>
					<li>Use <strong>AUTO</strong> on the chat box to chain tool calls automatically.</li>
					<li>Need to add a custom MCP server? Click the <strong>MCP (n)</strong> pill → Add Server.</li>
				</ol>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Models available</h3>
				<div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
					<table class="w-full text-xs">
						<thead class="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
							<tr>
								<th class="px-3 py-2 text-left font-medium">Model</th>
								<th class="px-3 py-2 text-left font-medium">Provider</th>
								<th class="px-3 py-2 text-left font-medium">Best for</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-200 dark:divide-gray-700">
							{#each models as m}
								<tr class={m.isDefault ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}>
									<td class="px-3 py-2 align-top">
										<div class="font-medium">{m.name}</div>
										{#if m.isDefault}
											<span class="mt-0.5 inline-block rounded bg-blue-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">DEFAULT</span>
										{/if}
									</td>
									<td class="px-3 py-2 align-top text-gray-600 dark:text-gray-400">{m.provider}</td>
									<td class="px-3 py-2 align-top">
										<div>{m.strength}</div>
										<div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{m.notes}</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Cloud models route through OpenRouter — switch any time via <strong>Models</strong> in the sidebar.</p>
				<div class="mt-3 rounded-lg border border-emerald-300/40 bg-emerald-50/50 px-3 py-2 text-xs dark:border-emerald-700/40 dark:bg-emerald-900/10">
					<p class="font-semibold text-emerald-900 dark:text-emerald-200">🦾 Any model — including local + self-learning</p>
					<p class="mt-1 text-emerald-900/80 dark:text-emerald-200/80">RuFlo speaks any OpenAI-compatible endpoint: vLLM, Ollama, LM Studio, Together, Groq, or self-hosted. Native support for <a href="https://github.com/ruvnet/RuVector/tree/main/examples/ruvLLM" target="_blank" rel="noopener" class="underline">ruvLLM</a> (lives in <code>ruvnet/RuVector/examples/ruvLLM</code>) — RuFlo's self-improving local model layer with MicroLoRA adapters that learn from your trajectories via SONA. Pair cloud + local, or run fully offline.</p>
				</div>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Tool groups <span class="text-gray-400">(click to expand)</span></h3>
				<div class="space-y-2">
					{#each groups as group}
						<details
							class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
							open={openGroup === group.id}
							ontoggle={(e) => {
								if ((e.currentTarget as HTMLDetailsElement).open) openGroup = group.id;
								else if (openGroup === group.id) openGroup = null;
							}}
						>
							<summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
								<span>{group.emoji}</span>
								<span>{group.title}</span>
								<span class="ml-auto rounded bg-blue-600/10 px-1.5 py-0.5 text-xs text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
									{group.tools.length} tools
								</span>
							</summary>
							<div class="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
								<p class="mb-2 text-xs text-gray-600 dark:text-gray-400">{group.intro}</p>
								<ul class="space-y-1 text-xs">
									{#each group.tools as tool}
										<li class="flex gap-2">
											<code class="shrink-0 rounded bg-white px-1 py-0.5 text-[11px] font-mono dark:bg-gray-900">{tool.name}</code>
											<span class="text-gray-700 dark:text-gray-300">{tool.desc}</span>
										</li>
									{/each}
								</ul>
							</div>
						</details>
					{/each}
				</div>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Try these</h3>
				<ul class="space-y-1.5 text-xs">
					{#each examplePrompts as prompt}
						<li class="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
							{prompt}
						</li>
					{/each}
				</ul>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Tool-call cards — what the icons mean</h3>
				<ul class="space-y-1 text-xs">
					{#each cardLegend as legend}
						<li class="flex gap-2">
							<code class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">{legend.mark}</code>
							<span class="text-gray-700 dark:text-gray-300">{legend.meaning}</span>
						</li>
					{/each}
				</ul>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Under the hood</h3>
				<p class="mb-2 text-xs text-gray-600 dark:text-gray-400">RuFlo's web UI is a fork of the open-source HuggingFace chat-ui (SvelteKit) wired to a custom MCP bridge that fans out to two backend kernels. Everything runs on Google Cloud Run.</p>
				<div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
					<table class="w-full text-xs">
						<tbody class="divide-y divide-gray-200 dark:divide-gray-700">
							{#each stack as layer}
								<tr>
									<td class="whitespace-nowrap px-3 py-1.5 align-top font-mono font-medium">{layer.name}</td>
									<td class="px-3 py-1.5 align-top text-gray-600 dark:text-gray-400">{layer.role}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Domain aliases — pick one, they all work</h3>
				<ul class="space-y-1 text-xs">
					{#each domains as d}
						<li class="flex flex-wrap gap-2">
							<code class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">{d.url}</code>
							<span class="text-gray-600 dark:text-gray-400">{d.note}</span>
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">Custom domains DNS through Cloudflare unproxied so Google issues + auto-renews the TLS certificate. All four endpoints serve the same Cloud Run revision.</p>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Keyboard shortcuts</h3>
				<ul class="space-y-1 text-xs">
					{#each shortcuts as s}
						<li class="flex gap-2">
							<code class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">{s.keys}</code>
							<span class="text-gray-700 dark:text-gray-300">{s.action}</span>
						</li>
					{/each}
				</ul>
			</section>

			<section class="mb-6">
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Tips</h3>
				<ul class="list-disc space-y-1.5 pl-5 text-sm">
					{#each tips as tip}
						<li>{@html tip.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code class="rounded bg-gray-100 px-1 dark:bg-gray-800">$1</code>')}</li>
					{/each}
				</ul>
			</section>

			<section>
				<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Resources</h3>
				<ul class="space-y-1 text-sm">
					<li>
						<a href="https://github.com/ruvnet/ruflo" target="_blank" rel="noopener" class="text-blue-600 hover:underline dark:text-blue-400">
							github.com/ruvnet/ruflo →
						</a>
					</li>
					<li>
						<a href="https://github.com/ruvnet/ruflo/blob/main/ruflo/docs/adr/ADR-033-RUVOCAL-WASM-MCP-INTEGRATION.md" target="_blank" rel="noopener" class="text-blue-600 hover:underline dark:text-blue-400">
							ADR-033 — Web UI architecture →
						</a>
					</li>
					<li>
						<a href="https://github.com/ruvnet/ruflo/issues/1689" target="_blank" rel="noopener" class="text-blue-600 hover:underline dark:text-blue-400">
							Issue #1689 — UI capabilities & roadmap →
						</a>
					</li>
					<li>
						<a href="https://github.com/ruvnet/ruvector" target="_blank" rel="noopener" class="text-blue-600 hover:underline dark:text-blue-400">
							ruvnet/ruvector — intelligence layer →
						</a>
					</li>
				</ul>
			</section>
		</div>

		<footer class="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
			<button
				type="button"
				onclick={() => onclose?.()}
				class="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-black dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
			>
				Got it
			</button>
		</footer>
	</div>
</Modal>
