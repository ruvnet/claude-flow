import type { MessageFile } from "$lib/types/Message";
import {
	type MessageUpdate,
	type MessageToolUpdate,
	type MessageToolCallUpdate,
	type MessageToolResultUpdate,
	type MessageToolErrorUpdate,
	type MessageToolProgressUpdate,
	MessageUpdateType,
	MessageToolUpdateType,
} from "$lib/types/MessageUpdate";
import type { StreamingMode } from "$lib/types/Settings";
import type { KeyValuePair } from "$lib/types/Tool";

type MessageUpdateRequestOptions = {
	base: string;
	inputs?: string;
	messageId?: string;
	isRetry: boolean;
	isContinue?: boolean;
	files?: MessageFile[];
	// Optional: pass selected MCP server names (client-side selection)
	selectedMcpServerNames?: string[];
	// Optional: pass selected MCP server configs (for custom client-defined servers)
	selectedMcpServers?: Array<{ name: string; url: string; headers?: KeyValuePair[] }>;
	streamingMode?: StreamingMode;
	autopilot?: boolean;
};

type ChunkDetector = (buffer: string) => string | null;

type SmoothStreamConfig = {
	minDelayMs?: number;
	maxDelayMs?: number;
	minRateCharsPerMs?: number;
	maxBufferedMs?: number;
	_internal?: {
		now?: () => number;
		sleep?: (ms: number) => Promise<void>;
		detectChunk?: ChunkDetector;
		isPageHidden?: () => boolean;
	};
};

export async function fetchMessageUpdates(
	conversationId: string,
	opts: MessageUpdateRequestOptions,
	abortSignal: AbortSignal
): Promise<AsyncGenerator<MessageUpdate>> {
	const abortController = new AbortController();
	abortSignal.addEventListener("abort", () => abortController.abort());

	const form = new FormData();

	const optsJSON = JSON.stringify({
		inputs: opts.inputs,
		id: opts.messageId,
		is_retry: opts.isRetry,
		is_continue: Boolean(opts.isContinue),
		// Will be ignored server-side if unsupported
		selectedMcpServerNames: opts.selectedMcpServerNames,
		selectedMcpServers: opts.selectedMcpServers,
		autopilot: opts.autopilot,
	});

	opts.files?.forEach((file) => {
		const name = file.type + ";" + file.name;

		form.append("files", new File([file.value], name, { type: file.mime }));
	});

	form.append("data", optsJSON);

	const response = await fetch(`${opts.base}/conversation/${conversationId}`, {
		method: "POST",
		body: form,
		signal: abortController.signal,
	});

	if (!response.ok) {
		const errorMessage = await response
			.json()
			.then((obj) => obj.message)
			.catch(() => `Request failed with status code ${response.status}: ${response.statusText}`);
		throw Error(errorMessage);
	}
	if (!response.body) {
		throw Error("Body not defined");
	}

	return applyStreamingMode(
		endpointStreamToIterator(response, abortController),
		opts.streamingMode ?? "smooth"
	);
}

export function applyStreamingMode(
	iterator: AsyncGenerator<MessageUpdate>,
	streamingMode: StreamingMode
): AsyncGenerator<MessageUpdate> {
	if (streamingMode === "smooth") {
		return smoothStreamUpdates(iterator);
	}

	// "raw" keeps source stream intact.
	return iterator;
}

export function resolveStreamingMode(s: { streamingMode?: unknown }): StreamingMode {
	return s.streamingMode === "raw" || s.streamingMode === "smooth" ? s.streamingMode : "smooth";
}

async function* endpointStreamToIterator(
	response: Response,
	abortController: AbortController
): AsyncGenerator<MessageUpdate> {
	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
	if (!reader) throw Error("Response for endpoint had no body");

	// Handle any cases where we must abort
	reader.closed.then(() => abortController.abort());

	// Handle logic for aborting
	abortController.signal.addEventListener("abort", () => reader.cancel());

	// ex) If the last response is => {"type": "stream", "token":
	// It should be => {"type": "stream", "token": "Hello"} = prev_input_chunk + "Hello"}
	let prevChunk = "";
	while (!abortController.signal.aborted) {
		const { done, value } = await reader.read();
		if (done) {
			abortController.abort();
			break;
		}
		if (!value) continue;

		const { messageUpdates, remainingText } = parseMessageUpdates(prevChunk + value);
		prevChunk = remainingText;
		for (const messageUpdate of messageUpdates) yield messageUpdate;
	}
}

function parseMessageUpdates(value: string): {
	messageUpdates: MessageUpdate[];
	remainingText: string;
} {
	const inputs = value.split("\n");
	const messageUpdates: MessageUpdate[] = [];
	for (const input of inputs) {
		try {
			messageUpdates.push(JSON.parse(input) as MessageUpdate);
		} catch (error) {
			// in case of parsing error, we return what we were able to parse
			if (error instanceof SyntaxError) {
				return {
					messageUpdates,
					remainingText: inputs.at(-1) ?? "",
				};
			}
		}
	}
	return { messageUpdates, remainingText: "" };
}

export async function* smoothStreamUpdates(
	iterator: AsyncGenerator<MessageUpdate>,
	{
		minDelayMs = 5,
		maxDelayMs = 80,
		minRateCharsPerMs = 0.3,
		maxBufferedMs = 400,
		_internal: {
			now = () => performance.now(),
			sleep = defaultSleep,
			detectChunk,
			isPageHidden = defaultIsPageHidden,
		} = {},
	}: SmoothStreamConfig = {}
): AsyncGenerator<MessageUpdate> {
	const chunkDetector = detectChunk ?? createWordChunkDetector();
	const eventTarget = new EventTarget();
	const outputQueue: Array<{ update: MessageUpdate }> = [];
	let producerDone = false;
	let producerError: unknown = null;
	let pendingBuffer = "";
	let queuedStreamChars = 0;

	const enqueue = (update: MessageUpdate) => {
		if (update.type === MessageUpdateType.Stream) {
			queuedStreamChars += update.token.length;
		}
		outputQueue.push({ update });
		eventTarget.dispatchEvent(new Event("next"));
	};

	const flushPendingBuffer = () => {
		if (pendingBuffer.length === 0) return;
		enqueue({ type: MessageUpdateType.Stream, token: pendingBuffer });
		pendingBuffer = "";
	};

	const producer = (async () => {
		for await (const messageUpdate of iterator) {
			if (messageUpdate.type !== MessageUpdateType.Stream) {
				flushPendingBuffer();
				enqueue(messageUpdate);
				continue;
			}

			if (!messageUpdate.token) continue;

			pendingBuffer += messageUpdate.token;
			let chunk: string | null;
			while ((chunk = chunkDetector(pendingBuffer)) !== null) {
				if (chunk.length === 0) break;
				enqueue({ type: MessageUpdateType.Stream, token: chunk });
				pendingBuffer = pendingBuffer.slice(chunk.length);
			}
		}
		flushPendingBuffer();
	})()
		.catch((error) => {
			producerError = error;
		})
		.finally(() => {
			producerDone = true;
			eventTarget.dispatchEvent(new Event("next"));
		});

	// Character-rate targeting consumer
	let totalCharsEmitted = 0;
	let firstEmitAt: number | null = null;

	while (!producerDone || outputQueue.length > 0) {
		if (outputQueue.length === 0) {
			await waitForEvent(eventTarget, "next");
			continue;
		}

		const next = outputQueue.shift();
		if (!next) continue;

		if (next.update.type === MessageUpdateType.Stream) {
			const tokenLen = next.update.token.length;
			queuedStreamChars = Math.max(0, queuedStreamChars - tokenLen);
			totalCharsEmitted += tokenLen;

			if (firstEmitAt === null) firstEmitAt = now();

			const elapsedMs = now() - firstEmitAt;
			const currentRate = elapsedMs > 0 ? totalCharsEmitted / elapsedMs : 0;
			const backlogChars = tokenLen + queuedStreamChars;
			const backlogRate = maxBufferedMs > 0 ? backlogChars / maxBufferedMs : 0;
			const targetRate = Math.max(currentRate, minRateCharsPerMs, backlogRate);
			const rawDelay = tokenLen / targetRate;
			const underBacklogPressure = backlogRate > minRateCharsPerMs;
			const effectiveMinDelayMs = underBacklogPressure ? 0 : minDelayMs;
			const delayMs = Math.round(Math.max(effectiveMinDelayMs, Math.min(maxDelayMs, rawDelay)));

			if (delayMs > 0 && !isPageHidden()) {
				await sleep(delayMs);
			}
		}

		yield next.update;
	}

	await producer;
	if (producerError) throw producerError;
}

function createWordChunkDetector(): ChunkDetector {
	if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		return (buffer: string): string | null => {
			if (buffer.length === 0) return null;
			let cursor = 0;
			let boundary = 0;
			let sawWordLike = false;

			for (const part of segmenter.segment(buffer)) {
				cursor += part.segment.length;
				if (part.isWordLike) {
					sawWordLike = true;
					continue;
				}
				if (sawWordLike) {
					boundary = cursor;
					break;
				}
			}

			return boundary > 0 ? buffer.slice(0, boundary) : null;
		};
	}

	const wordWithTrailingBoundary = /\S+\s+/m;
	return (buffer: string): string | null => {
		const match = wordWithTrailingBoundary.exec(buffer);
		if (!match) return null;
		return buffer.slice(0, match.index) + match[0];
	};
}

// Tool update type guards for UI rendering
export const isMessageToolUpdate = (update: MessageUpdate): update is MessageToolUpdate =>
	update.type === MessageUpdateType.Tool;

export const isMessageToolCallUpdate = (update: MessageUpdate): update is MessageToolCallUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Call;

export const isMessageToolResultUpdate = (
	update: MessageUpdate
): update is MessageToolResultUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Result;

export const isMessageToolErrorUpdate = (update: MessageUpdate): update is MessageToolErrorUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Error;

export const isMessageToolProgressUpdate = (
	update: MessageUpdate
): update is MessageToolProgressUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Progress;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
const defaultIsPageHidden = (): boolean =>
	typeof document !== "undefined" && document.visibilityState === "hidden";
const waitForEvent = (eventTarget: EventTarget, eventName: string) =>
	new Promise<boolean>((resolve) =>
		eventTarget.addEventListener(eventName, () => resolve(true), { once: true })
	);
