import { config } from "$lib/server/config";
import { mergeMcpServers } from "./mergeServers";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { getMcpServers } from "$lib/server/mcp/registry";
import { isValidUrl } from "$lib/server/urlSafety";
import { resetMcpToolsCache } from "$lib/server/mcp/tools";
import { getOpenAiToolsForMcp } from "$lib/server/mcp/tools";
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import { buildToolPreprompt } from "../utils/toolPrompt";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { resolveRouterTarget } from "./routerResolution";
import { executeToolCalls, type NormalizedToolCall } from "./toolInvocation";
import { drainPool } from "$lib/server/mcp/clientPool";
import type { TextGenerationContext } from "../types";
import {
	hasAuthHeader,
	isStrictHfMcpLogin,
	hasNonEmptyToken,
	isExaMcpServer,
} from "$lib/server/mcp/hf";
import { buildImageRefResolver } from "./fileRefs";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import { makeImageProcessor } from "$lib/server/endpoints/images";
import { logger } from "$lib/server/logger";
import { AbortedGenerations } from "$lib/server/abortedGenerations";

export type RunMcpFlowContext = Pick<
	TextGenerationContext,
	"model" | "conv" | "assistant" | "forceMultimodal" | "forceTools" | "provider" | "locals"
> & { messages: EndpointMessage[] };

// Return type: "completed" = MCP ran successfully, "not_applicable" = MCP didn't run, "aborted" = user aborted
export type McpFlowResult = "completed" | "not_applicable" | "aborted";

export async function* runMcpFlow({
	model,
	conv,
	messages,
	assistant,
	forceMultimodal,
	forceTools,
	provider,
	locals,
	preprompt,
	abortSignal,
	abortController,
	promptedAt,
	autopilot,
	autopilotMaxSteps,
}: RunMcpFlowContext & {
	preprompt?: string;
	abortSignal?: AbortSignal;
	abortController?: AbortController;
	promptedAt?: Date;
	autopilot?: boolean;
	autopilotMaxSteps?: number;
}): AsyncGenerator<MessageUpdate, McpFlowResult, undefined> {
	// Helper to check if generation should be aborted via DB polling
	// Also triggers the abort controller to cancel active streams/requests
	const checkAborted = (): boolean => {
		if (abortSignal?.aborted) return true;
		const abortTime = AbortedGenerations.getInstance().getAbortTime(conv._id.toString());
		if (abortTime && promptedAt && abortTime > promptedAt) {
			// Trigger the abort controller to cancel active streams
			if (abortController && !abortController.signal.aborted) {
				abortController.abort();
			}
			return true;
		}
		return false;
	};
	// Start from env-configured servers
	let servers = getMcpServers();
	try {
		logger.debug(
			{ baseServers: servers.map((s) => ({ name: s.name, url: s.url })), count: servers.length },
			"[mcp] base servers loaded"
		);
	} catch {}

	// Merge in request-provided custom servers (if any)
	try {
		const reqMcp = (
			locals as unknown as {
				mcp?: {
					selectedServers?: Array<{ name: string; url: string; headers?: Record<string, string> }>;
					selectedServerNames?: string[];
				};
			}
		)?.mcp;
		const custom = Array.isArray(reqMcp?.selectedServers) ? reqMcp?.selectedServers : [];
		if (custom.length > 0) {
			// Invalidate cached tool list when the set of servers changes at request-time
			resetMcpToolsCache();
			// Deduplicate by server name (request takes precedence)
			servers = mergeMcpServers(servers, custom);
			try {
				logger.debug(
					{
						customProvidedCount: custom.length,
						mergedServers: servers.map((s) => ({
							name: s.name,
							url: s.url,
							hasAuth: !!s.headers?.Authorization,
						})),
					},
					"[mcp] merged request-provided servers"
				);
			} catch {}
		}

		// If the client specified a selection by name, filter to those
		const names = Array.isArray(reqMcp?.selectedServerNames)
			? reqMcp?.selectedServerNames
			: undefined;
		if (Array.isArray(names)) {
			const before = servers.map((s) => s.name);
			servers = servers.filter((s) => names.includes(s.name));
			try {
				logger.debug(
					{ selectedNames: names, before, after: servers.map((s) => s.name) },
					"[mcp] applied name selection"
				);
			} catch {}
		}
	} catch {
		// ignore selection merge errors and proceed with env servers
	}

	// If selection/merge yielded no servers, bail early with clearer log
	if (servers.length === 0) {
		logger.warn({}, "[mcp] no MCP servers selected after merge/name filter");
		return "not_applicable";
	}

	// Enforce server-side safety (public HTTPS only, no private ranges)
	{
		const before = servers.slice();
		servers = servers.filter((s) => {
			try {
				return isValidUrl(s.url);
			} catch {
				return false;
			}
		});
		try {
			const rejected = before.filter((b) => !servers.includes(b));
			if (rejected.length > 0) {
				logger.warn(
					{ rejected: rejected.map((r) => ({ name: r.name, url: r.url })) },
					"[mcp] rejected servers by URL safety"
				);
			}
		} catch {}
	}
	if (servers.length === 0) {
		logger.warn({}, "[mcp] all selected MCP servers rejected by URL safety guard");
		return "not_applicable";
	}

	// Optionally attach the logged-in user's HF token to the official HF MCP server only.
	// Never override an explicit Authorization header, and require token to look like an HF token.
	try {
		const shouldForward = config.MCP_FORWARD_HF_USER_TOKEN === "true";
		const userToken =
			(locals as unknown as { hfAccessToken?: string } | undefined)?.hfAccessToken ??
			(locals as unknown as { token?: string } | undefined)?.token;

		if (shouldForward && hasNonEmptyToken(userToken)) {
			const overlayApplied: string[] = [];
			servers = servers.map((s) => {
				try {
					if (isStrictHfMcpLogin(s.url) && !hasAuthHeader(s.headers)) {
						overlayApplied.push(s.name);
						return {
							...s,
							headers: { ...(s.headers ?? {}), Authorization: `Bearer ${userToken}` },
						};
					}
				} catch {
					// ignore URL parse errors and leave server unchanged
				}
				return s;
			});
			if (overlayApplied.length > 0) {
				try {
					logger.debug({ overlayApplied }, "[mcp] forwarded HF token to servers");
				} catch {}
			}
		}
	} catch {
		// best-effort overlay; continue if anything goes wrong
	}

	// Inject Exa API key for mcp.exa.ai servers via URL param (mcp.exa.ai doesn't support headers)
	try {
		const exaApiKey = config.EXA_API_KEY;
		if (hasNonEmptyToken(exaApiKey)) {
			const overlayApplied: string[] = [];
			servers = servers.map((s) => {
				try {
					if (isExaMcpServer(s.url)) {
						const url = new URL(s.url);
						if (!url.searchParams.has("exaApiKey")) {
							url.searchParams.set("exaApiKey", exaApiKey);
							overlayApplied.push(s.name);
							return { ...s, url: url.toString() };
						}
					}
				} catch {}
				return s;
			});
			if (overlayApplied.length > 0) {
				logger.debug({ overlayApplied }, "[mcp] injected Exa API key to servers");
			}
		}
	} catch {
		// best-effort injection; continue if anything goes wrong
	}

	logger.debug(
		{ count: servers.length, servers: servers.map((s) => s.name) },
		"[mcp] servers configured"
	);
	if (servers.length === 0) {
		return "not_applicable";
	}

	// Gate MCP flow based on model tool support (aggregated) with user override
	try {
		const supportsTools = Boolean((model as unknown as { supportsTools?: boolean }).supportsTools);
		const toolsEnabled = Boolean(forceTools) || supportsTools;
		logger.debug(
			{
				model: model.id ?? model.name,
				supportsTools,
				forceTools: Boolean(forceTools),
				toolsEnabled,
			},
			"[mcp] tools gate evaluation"
		);
		if (!toolsEnabled) {
			logger.info(
				{ model: model.id ?? model.name },
				"[mcp] tools disabled for model; skipping MCP flow"
			);
			return "not_applicable";
		}
	} catch {
		// If anything goes wrong reading the flag, proceed (previous behavior)
	}

	const resolveFileRef = buildImageRefResolver(messages);
	const imageProcessor = makeImageProcessor({
		supportedMimeTypes: ["image/png", "image/jpeg"],
		preferredMimeType: "image/jpeg",
		maxSizeInMB: 1,
		maxWidth: 1024,
		maxHeight: 1024,
	});

	const hasImageInput = messages.some((msg) =>
		(msg.files ?? []).some(
			(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
		)
	);

	const { runMcp, targetModel, candidateModelId, resolvedRoute } = await resolveRouterTarget({
		model,
		messages,
		conversationId: conv._id.toString(),
		hasImageInput,
		locals,
	});

	if (!runMcp) {
		logger.info(
			{ model: targetModel.id ?? targetModel.name, resolvedRoute },
			"[mcp] runMcp=false (routing chose non-tools candidate)"
		);
		return "not_applicable";
	}

	try {
		const { tools: oaTools, mapping } = await getOpenAiToolsForMcp(servers, {
			signal: abortSignal,
		});
		try {
			logger.info(
				{ toolCount: oaTools.length, toolNames: oaTools.map((t) => t.function.name) },
				"[mcp] openai tool defs built"
			);
		} catch {}
		if (oaTools.length === 0) {
			logger.warn({}, "[mcp] zero tools available after listing; skipping MCP flow");
			return "not_applicable";
		}

		const { OpenAI } = await import("openai");

		// Capture provider header (x-inference-provider) from the upstream OpenAI-compatible server.
		let providerHeader: string | undefined;
		const captureProviderFetch = async (
			input: RequestInfo | URL,
			init?: RequestInit
		): Promise<Response> => {
			const res = await fetch(input, init);
			const p = res.headers.get("x-inference-provider");
			if (p && !providerHeader) providerHeader = p;
			return res;
		};

		const openai = new OpenAI({
			apiKey: config.OPENAI_API_KEY || config.HF_TOKEN || "sk-",
			baseURL: config.OPENAI_BASE_URL,
			fetch: captureProviderFetch,
			defaultHeaders: {
				// Bill to organization if configured (HuggingChat only)
				...(config.isHuggingChat && locals?.billingOrganization
					? { "X-HF-Bill-To": locals.billingOrganization }
					: {}),
			},
		});

		const mmEnabled = (forceMultimodal ?? false) || targetModel.multimodal;
		logger.info(
			{
				targetModel: targetModel.id ?? targetModel.name,
				mmEnabled,
				route: resolvedRoute,
				candidateModelId,
				toolCount: oaTools.length,
				hasUserToken: Boolean((locals as unknown as { token?: string })?.token),
			},
			"[mcp] starting completion with tools"
		);
		let messagesOpenAI: ChatCompletionMessageParam[] = await prepareMessagesWithFiles(
			messages,
			imageProcessor,
			mmEnabled
		);
		const toolPreprompt = buildToolPreprompt(oaTools, autopilot);
		const prepromptPieces: string[] = [];
		if (toolPreprompt.trim().length > 0) {
			prepromptPieces.push(toolPreprompt);
		}
		if (typeof preprompt === "string" && preprompt.trim().length > 0) {
			prepromptPieces.push(preprompt);
		}
		const mergedPreprompt = prepromptPieces.join("\n\n");
		const hasSystemMessage = messagesOpenAI.length > 0 && messagesOpenAI[0]?.role === "system";
		if (hasSystemMessage) {
			if (mergedPreprompt.length > 0) {
				const existing = messagesOpenAI[0].content ?? "";
				const existingText = typeof existing === "string" ? existing : "";
				messagesOpenAI[0].content = mergedPreprompt + (existingText ? "\n\n" + existingText : "");
			}
		} else if (mergedPreprompt.length > 0) {
			messagesOpenAI = [{ role: "system", content: mergedPreprompt }, ...messagesOpenAI];
		}

		// Work around servers that reject `system` role
		if (
			typeof config.OPENAI_BASE_URL === "string" &&
			config.OPENAI_BASE_URL.length > 0 &&
			(config.OPENAI_BASE_URL.includes("hf.space") ||
				config.OPENAI_BASE_URL.includes("gradio.app")) &&
			messagesOpenAI[0]?.role === "system"
		) {
			messagesOpenAI[0] = { ...messagesOpenAI[0], role: "user" };
		}

		const parameters = { ...targetModel.parameters, ...assistant?.generateSettings } as Record<
			string,
			unknown
		>;
		const maxTokens =
			(parameters?.max_tokens as number | undefined) ??
			(parameters?.max_new_tokens as number | undefined) ??
			(parameters?.max_completion_tokens as number | undefined);

		const stopSequences =
			typeof parameters?.stop === "string"
				? parameters.stop
				: Array.isArray(parameters?.stop)
					? (parameters.stop as string[])
					: undefined;

		// Build model ID with optional provider suffix (e.g., "model:fastest" or "model:together")
		const baseModelId = targetModel.id ?? targetModel.name;
		const modelIdWithProvider =
			provider && provider !== "auto" ? `${baseModelId}:${provider}` : baseModelId;

		const completionBase: Omit<ChatCompletionCreateParamsStreaming, "messages"> = {
			model: modelIdWithProvider,
			stream: true,
			temperature: typeof parameters?.temperature === "number" ? parameters.temperature : undefined,
			top_p: typeof parameters?.top_p === "number" ? parameters.top_p : undefined,
			frequency_penalty:
				typeof parameters?.frequency_penalty === "number"
					? parameters.frequency_penalty
					: typeof parameters?.repetition_penalty === "number"
						? parameters.repetition_penalty
						: undefined,
			presence_penalty:
				typeof parameters?.presence_penalty === "number" ? parameters.presence_penalty : undefined,
			stop: stopSequences,
			max_tokens: typeof maxTokens === "number" ? maxTokens : undefined,
			tools: oaTools,
			tool_choice: "auto",
		};

		const toPrimitive = (value: unknown) => {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				return value;
			}
			return undefined;
		};

		const parseArgs = (raw: unknown): Record<string, unknown> => {
			if (typeof raw !== "string" || raw.trim().length === 0) return {};
			try {
				return JSON.parse(raw);
			} catch {
				return {};
			}
		};

		const processToolOutput = (
			text: string
		): {
			annotated: string;
			sources: { index: number; link: string }[];
		} => ({ annotated: text, sources: [] });

		let lastAssistantContent = "";
		let streamedContent = false;
		// Track whether we're inside a <think> block when the upstream streams
		// provider-specific reasoning tokens (e.g. `reasoning` or `reasoning_content`).
		let thinkOpen = false;

		if (resolvedRoute && candidateModelId) {
			yield {
				type: MessageUpdateType.RouterMetadata,
				route: resolvedRoute,
				model: candidateModelId,
			};
			logger.debug(
				{ route: resolvedRoute, model: candidateModelId },
				"[mcp] router metadata emitted"
			);
		}

		// Autopilot loop cap is user-configurable (Settings.autopilotMaxSteps);
		// fall back to 30 for back-compat when the client doesn't send a value.
		// Non-autopilot mode keeps a tight 10-loop safety net regardless of caller input.
		const autopilotCap =
			typeof autopilotMaxSteps === "number" && autopilotMaxSteps > 0
				? Math.min(autopilotMaxSteps, 100)
				: 30;
		const maxLoops = autopilot ? autopilotCap : 10;
		for (let loop = 0; loop < maxLoops; loop += 1) {
			// Check for abort at the start of each loop iteration
			if (checkAborted()) {
				logger.info({ loop }, "[mcp] aborting at start of loop iteration");
				return "aborted";
			}

			lastAssistantContent = "";
			streamedContent = false;

			const completionRequest: ChatCompletionCreateParamsStreaming = {
				...completionBase,
				messages: messagesOpenAI,
			};

			const completionStream: Stream<ChatCompletionChunk> = await openai.chat.completions.create(
				completionRequest,
				{
					signal: abortSignal,
					headers: {
						"ChatUI-Conversation-ID": conv._id.toString(),
						"X-use-cache": "false",
						...(locals?.token ? { Authorization: `Bearer ${locals.token}` } : {}),
					},
				}
			);

			// If provider header was exposed, notify UI so it can render "via {provider}".
			if (providerHeader) {
				yield {
					type: MessageUpdateType.RouterMetadata,
					route: "",
					model: "",
					provider: providerHeader as unknown as import("@huggingface/inference").InferenceProvider,
				};
				logger.debug({ provider: providerHeader }, "[mcp] provider metadata emitted");
			}

			const toolCallState: Record<number, { id?: string; name?: string; arguments: string }> = {};
			let firstToolDeltaLogged = false;
			let sawToolCall = false;
			let tokenCount = 0;
			for await (const chunk of completionStream) {
				const choice = chunk.choices?.[0];
				const delta = choice?.delta;
				if (!delta) continue;

				const chunkToolCalls = delta.tool_calls ?? [];
				if (chunkToolCalls.length > 0) {
					sawToolCall = true;
					for (const call of chunkToolCalls) {
						const toolCall = call as unknown as {
							index?: number;
							id?: string;
							function?: { name?: string; arguments?: string };
						};
						const index = toolCall.index ?? 0;
						const current = toolCallState[index] ?? { arguments: "" };
						if (toolCall.id) current.id = toolCall.id;
						if (toolCall.function?.name) current.name = toolCall.function.name;
						if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
						toolCallState[index] = current;
					}
					if (!firstToolDeltaLogged) {
						try {
							const first =
								toolCallState[
									Object.keys(toolCallState)
										.map((k) => Number(k))
										.sort((a, b) => a - b)[0] ?? 0
								];
							logger.info(
								{ firstCallName: first?.name, hasId: Boolean(first?.id) },
								"[mcp] observed streamed tool_call delta"
							);
							firstToolDeltaLogged = true;
						} catch {}
					}
				}

				const deltaContent = (() => {
					if (typeof delta.content === "string") return delta.content;
					const maybeParts = delta.content as unknown;
					if (Array.isArray(maybeParts)) {
						return maybeParts
							.map((part) =>
								typeof part === "object" &&
								part !== null &&
								"text" in part &&
								typeof (part as Record<string, unknown>).text === "string"
									? String((part as Record<string, unknown>).text)
									: ""
							)
							.join("");
					}
					return "";
				})();

				// Provider-dependent reasoning fields (e.g., `reasoning` or `reasoning_content`).
				const deltaReasoning: string =
					typeof (delta as unknown as Record<string, unknown>)?.reasoning === "string"
						? ((delta as unknown as { reasoning?: string }).reasoning as string)
						: typeof (delta as unknown as Record<string, unknown>)?.reasoning_content === "string"
							? ((delta as unknown as { reasoning_content?: string }).reasoning_content as string)
							: "";

				// Merge reasoning + content into a single combined token stream, mirroring
				// the OpenAI adapter so the UI can auto-detect <think> blocks.
				let combined = "";
				if (deltaReasoning.trim().length > 0) {
					if (!thinkOpen) {
						combined += "<think>" + deltaReasoning;
						thinkOpen = true;
					} else {
						combined += deltaReasoning;
					}
				}

				if (deltaContent && deltaContent.length > 0) {
					if (thinkOpen) {
						combined += "</think>" + deltaContent;
						thinkOpen = false;
					} else {
						combined += deltaContent;
					}
				}

				if (combined.length > 0) {
					lastAssistantContent += combined;
					if (!sawToolCall) {
						streamedContent = true;
						yield { type: MessageUpdateType.Stream, token: combined };
						tokenCount += combined.length;
					}
				}

				// Periodic abort check during streaming
				if (checkAborted()) {
					logger.info({ loop, tokenCount }, "[mcp] aborting during stream");
					return "aborted";
				}
			}
			logger.info(
				{ sawToolCalls: Object.keys(toolCallState).length > 0, tokens: tokenCount, loop },
				"[mcp] completion stream closed"
			);

			// Check abort after stream completes
			if (checkAborted()) {
				logger.info({ loop }, "[mcp] aborting after stream completed");
				return "aborted";
			}

			// Auto-close any unclosed <think> block so reasoning from this loop
			// doesn't swallow content from subsequent iterations.  The client-side
			// regex matches `<think>` to end-of-string, so an unclosed block would
			// hide everything that follows.
			if (thinkOpen) {
				if (streamedContent) {
					yield { type: MessageUpdateType.Stream, token: "</think>" };
				}
				lastAssistantContent += "</think>";
				thinkOpen = false;
			}

			if (Object.keys(toolCallState).length > 0) {
				// If any streamed call is missing id, perform a quick non-stream retry to recover full tool_calls with ids
				const missingId = Object.values(toolCallState).some((c) => c?.name && !c?.id);
				let calls: NormalizedToolCall[];
				if (missingId) {
					logger.debug(
						{ loop },
						"[mcp] missing tool_call id in stream; retrying non-stream to recover ids"
					);
					const nonStream = await openai.chat.completions.create(
						{ ...completionBase, messages: messagesOpenAI, stream: false },
						{
							signal: abortSignal,
							headers: {
								"ChatUI-Conversation-ID": conv._id.toString(),
								"X-use-cache": "false",
								...(locals?.token ? { Authorization: `Bearer ${locals.token}` } : {}),
							},
						}
					);
					const tc = nonStream.choices?.[0]?.message?.tool_calls ?? [];
					calls = tc.map((t) => ({
						id: t.id,
						name: t.function?.name ?? "",
						arguments: t.function?.arguments ?? "",
					}));
				} else {
					calls = Object.values(toolCallState)
						.map((c) => (c?.id && c?.name ? c : undefined))
						.filter(Boolean)
						.map((c) => ({
							id: c?.id ?? "",
							name: c?.name ?? "",
							arguments: c?.arguments ?? "",
						})) as NormalizedToolCall[];
				}

				// Include the assistant message with tool_calls so the next round
				// sees both the calls and their outputs, matching MCP branch behavior.
				const toolCalls: ChatCompletionMessageToolCall[] = calls.map((call) => ({
					id: call.id,
					type: "function",
					function: { name: call.name, arguments: call.arguments },
				}));

				// Avoid sending <think> content back to the model alongside tool_calls
				// to prevent confusing follow-up reasoning. Strip any think blocks.
				const assistantContentForToolMsg = lastAssistantContent.replace(
					/<think>[\s\S]*?(?:<\/think>|$)/g,
					""
				);
				const assistantToolMessage: ChatCompletionMessageParam = {
					role: "assistant",
					content: assistantContentForToolMsg,
					tool_calls: toolCalls,
				};

				const exec = executeToolCalls({
					calls,
					mapping,
					servers,
					parseArgs,
					resolveFileRef,
					toPrimitive,
					processToolOutput,
					abortSignal,
				});
				let toolMsgCount = 0;
				let toolRunCount = 0;
				for await (const event of exec) {
					if (event.type === "update") {
						yield event.update;
					} else {
						messagesOpenAI = [
							...messagesOpenAI,
							assistantToolMessage,
							...(event.summary.toolMessages ?? []),
						];
						toolMsgCount = event.summary.toolMessages?.length ?? 0;
						toolRunCount = event.summary.toolRuns?.length ?? 0;
						logger.info(
							{ toolMsgCount, toolRunCount },
							"[mcp] tools executed; continuing loop for follow-up completion"
						);
					}

					// Check abort during tool execution
					if (checkAborted()) {
						logger.info({ loop, toolMsgCount }, "[mcp] aborting during tool execution");
						return "aborted";
					}
				}

				// Check abort after all tools complete before continuing loop
				if (checkAborted()) {
					logger.info({ loop }, "[mcp] aborting after tool execution");
					return "aborted";
				}
				// Emit autopilot step event so the UI can show progress
				if (autopilot) {
					yield {
						type: MessageUpdateType.AutopilotStep,
						step: loop + 1,
						maxSteps: maxLoops,
						toolCount: toolRunCount,
					};
				}
				// Continue loop: next iteration will use tool messages to get the final content
				continue;
			}

			// No tool calls in this iteration
			// If a <think> block is still open, close it for the final output
			if (thinkOpen) {
				lastAssistantContent += "</think>";
				thinkOpen = false;
			}

			// Autopilot auto-continue: if the model stopped to ask a question or
			// explain what it plans to do instead of calling tools, re-prompt it
			// to continue executing autonomously.
			if (autopilot && loop < maxLoops - 1) {
				const trimmed = lastAssistantContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "").trim();
				const looksLikeQuestion =
					trimmed.endsWith("?") ||
					/\b(shall I|should I|would you like|do you want|let me know|can I)\b/i.test(trimmed);
				const looksLikePartial =
					/\b(first|next|then|now I'll|I will|let me|I'm going to|here's my plan)\b/i.test(trimmed);

				if (looksLikeQuestion || looksLikePartial) {
					// Stream the partial content so user sees what the model said
					if (!streamedContent && trimmed.length > 0) {
						yield { type: MessageUpdateType.Stream, token: lastAssistantContent };
					}
					// Add the assistant's response and a continuation prompt
					messagesOpenAI = [
						...messagesOpenAI,
						{ role: "assistant", content: lastAssistantContent },
						{
							role: "user",
							content:
								"Continue executing autonomously. Do not ask questions — make reasonable assumptions and use tools to complete the task. Proceed now.",
						},
					];
					logger.info(
						{ loop, looksLikeQuestion, looksLikePartial },
						"[mcp] autopilot auto-continue: re-prompting model to keep going"
					);
					// Emit autopilot step
					yield {
						type: MessageUpdateType.AutopilotStep,
						step: loop + 1,
						maxSteps: maxLoops,
						toolCount: 0,
					};
					continue;
				}
			}

			if (!streamedContent && lastAssistantContent.trim().length > 0) {
				yield { type: MessageUpdateType.Stream, token: lastAssistantContent };
			}
			yield {
				type: MessageUpdateType.FinalAnswer,
				text: lastAssistantContent,
				interrupted: false,
			};
			logger.info(
				{ length: lastAssistantContent.length, loop },
				"[mcp] final answer emitted (no tool_calls)"
			);
			return "completed";
		}
		logger.warn({}, "[mcp] exceeded tool-followup loops; falling back");
	} catch (err) {
		const msg = String(err ?? "");
		const isAbort =
			(abortSignal && abortSignal.aborted) ||
			msg.includes("AbortError") ||
			msg.includes("APIUserAbortError") ||
			msg.includes("Request was aborted");
		if (isAbort) {
			// Expected on user stop; keep logs quiet and do not treat as error
			logger.debug({}, "[mcp] aborted by user");
			return "aborted";
		}
		logger.warn({ err: msg }, "[mcp] flow failed, falling back to default endpoint");
	} finally {
		// ensure MCP clients are closed after the turn
		await drainPool();
	}

	return "not_applicable";
}
