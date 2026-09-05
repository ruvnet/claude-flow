import { describe, expect, it } from "vitest";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { applyStreamingMode, resolveStreamingMode, smoothStreamUpdates } from "./messageUpdates";

async function* fromArray<T>(values: T[]): AsyncGenerator<T> {
	for (const value of values) {
		yield value;
	}
}

async function collect(iter: AsyncGenerator<MessageUpdate>) {
	const updates: MessageUpdate[] = [];
	for await (const update of iter) {
		updates.push(update);
	}
	return updates;
}

const streamText = (updates: MessageUpdate[]) =>
	updates
		.filter((u) => u.type === MessageUpdateType.Stream)
		.map((u) => u.token)
		.join("");

describe("smoothStreamUpdates", () => {
	it("merges partial words and preserves final text", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "Hel" },
			{ type: MessageUpdateType.Stream, token: "lo " },
			{ type: MessageUpdateType.Stream, token: "wor" },
			{ type: MessageUpdateType.Stream, token: "ld!" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 0,
				maxDelayMs: 0,
				_internal: { detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null },
			})
		);

		const streamedChunks = updates.filter((u) => u.type === MessageUpdateType.Stream);
		expect(streamedChunks.map((u) => u.token)).toEqual(["Hello ", "world!"]);
		expect(streamText(updates)).toBe("Hello world!");
	});

	it("flushes buffered stream text before non-stream updates", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "hello" },
			{ type: MessageUpdateType.Stream, token: " world" },
			{ type: MessageUpdateType.Title, title: "done" },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);
		expect(updates[0]).toMatchObject({ type: MessageUpdateType.Stream });
		expect(updates[1]).toMatchObject({ type: MessageUpdateType.Stream });
		expect(updates[2]).toEqual({ type: MessageUpdateType.Title, title: "done" });
		expect(streamText(updates)).toBe("hello world");
	});

	it("spreads burst tokens over time", async () => {
		const bigToken = "word ".repeat(40); // 200 chars, 40 words
		const source: MessageUpdate[] = [{ type: MessageUpdateType.Stream, token: bigToken }];
		let nowMs = 0;
		const emitTimes: number[] = [];

		const iter = smoothStreamUpdates(fromArray(source), {
			minDelayMs: 5,
			maxDelayMs: 80,
			minRateCharsPerMs: 0.3,
			_internal: {
				now: () => nowMs,
				sleep: async (ms: number) => {
					nowMs += ms;
				},
				detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
			},
		});

		for await (const update of iter) {
			if (update.type === MessageUpdateType.Stream) {
				emitTimes.push(nowMs);
			}
		}

		// Should have multiple emissions
		expect(emitTimes.length).toBeGreaterThan(5);
		// Gap between first and last emission should be significant (not instant dump)
		const totalSpread = (emitTimes.at(-1) ?? 0) - (emitTimes[0] ?? 0);
		expect(totalSpread).toBeGreaterThan(100);
	});

	it("keeps delays within configured bounds", async () => {
		const source: MessageUpdate[] = [
			{
				type: MessageUpdateType.Stream,
				token: "one two three four five six seven eight nine ten ",
			},
		];
		const delays: number[] = [];
		let nowMs = 0;

		await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 5,
				maxDelayMs: 80,
				minRateCharsPerMs: 0.3,
				_internal: {
					now: () => nowMs,
					sleep: async (ms: number) => {
						delays.push(ms);
						nowMs += ms;
					},
					detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
				},
			})
		);

		expect(delays.length).toBeGreaterThan(2);
		expect(delays.every((d) => d >= 5 && d <= 80)).toBe(true);
		// First delay should be >= later delays (rate floor dominates initially)
		expect(delays[0]).toBeGreaterThanOrEqual(delays.at(-1) ?? 0);
	});

	it("drains stream chunks without timer pacing while the page is hidden", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "one two three four five " },
		];
		const delays: number[] = [];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 5,
				maxDelayMs: 80,
				_internal: {
					sleep: async (ms: number) => {
						delays.push(ms);
					},
					isPageHidden: () => true,
					detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
				},
			})
		);

		expect(streamText(updates)).toBe("one two three four five ");
		expect(delays).toEqual([]);
	});

	it("handles CJK text correctly", async () => {
		const source: MessageUpdate[] = [{ type: MessageUpdateType.Stream, token: "你好，世界！" }];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);

		expect(streamText(updates)).toBe("你好，世界！");
	});

	it("propagates source errors to consumer", async () => {
		async function* failingSource(): AsyncGenerator<MessageUpdate> {
			yield { type: MessageUpdateType.Stream, token: "hello " };
			throw new Error("source failed");
		}

		await expect(
			collect(smoothStreamUpdates(failingSource(), { minDelayMs: 0, maxDelayMs: 0 }))
		).rejects.toThrow("source failed");
	});

	it("propagates source errors even when no full chunk was emitted yet", async () => {
		async function* failingSource(): AsyncGenerator<MessageUpdate> {
			yield { type: MessageUpdateType.Stream, token: "hel" };
			throw new Error("source failed");
		}

		await expect(
			collect(
				smoothStreamUpdates(failingSource(), {
					minDelayMs: 0,
					maxDelayMs: 0,
					_internal: { detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null },
				})
			)
		).rejects.toThrow("source failed");
	});

	it("drains queued stream chunks before throwing source errors", async () => {
		async function* failingSource(): AsyncGenerator<MessageUpdate> {
			yield { type: MessageUpdateType.Stream, token: "a " };
			yield { type: MessageUpdateType.Stream, token: "b " };
			yield { type: MessageUpdateType.Stream, token: "c " };
			throw new Error("source failed");
		}

		const seen: MessageUpdate[] = [];
		let seenError: Error | null = null;
		try {
			for await (const update of smoothStreamUpdates(failingSource(), {
				minDelayMs: 0,
				maxDelayMs: 0,
				_internal: { detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null },
			})) {
				seen.push(update);
			}
		} catch (error) {
			seenError = error as Error;
		}

		expect(streamText(seen)).toBe("a b c ");
		expect(seenError?.message).toBe("source failed");
	});

	it("caps burst tail latency with backlog acceleration", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "word ".repeat(500) },
		];
		let nowMs = 0;
		await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 5,
				maxDelayMs: 80,
				minRateCharsPerMs: 0.3,
				maxBufferedMs: 400,
				_internal: {
					now: () => nowMs,
					sleep: async (ms: number) => {
						nowMs += ms;
					},
					detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
				},
			})
		);

		expect(nowMs).toBeLessThan(1500);
	});

	it("skips empty tokens gracefully", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "" },
			{ type: MessageUpdateType.Stream, token: "hello " },
			{ type: MessageUpdateType.Stream, token: "" },
			{ type: MessageUpdateType.Stream, token: "world!" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);
		expect(streamText(updates)).toBe("hello world!");
	});
});

describe("applyStreamingMode", () => {
	it("keeps stream unchanged for raw mode", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "Hello" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const raw = await collect(applyStreamingMode(fromArray(source), "raw"));

		expect(raw).toEqual(source);
	});
});

describe("resolveStreamingMode", () => {
	it("returns explicit streamingMode when set", () => {
		expect(resolveStreamingMode({ streamingMode: "raw" })).toBe("raw");
		expect(resolveStreamingMode({ streamingMode: "smooth" })).toBe("smooth");
	});

	it("defaults to smooth when unset", () => {
		expect(resolveStreamingMode({})).toBe("smooth");
	});

	it("maps unsupported legacy values to smooth", () => {
		expect(resolveStreamingMode({ streamingMode: "final" })).toBe("smooth");
	});
});
