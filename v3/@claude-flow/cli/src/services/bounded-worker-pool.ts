export interface BoundedTask<T> {
  id: string;
  run: (signal: AbortSignal) => Promise<T>;
}

export interface BoundedTaskResult<T> {
  id: string;
  status: 'fulfilled' | 'rejected' | 'cancelled';
  value?: T;
  error?: string;
}

export interface BoundedPoolResult<T> {
  results: BoundedTaskResult<T>[];
  peakConcurrency: number;
  durationMs: number;
}

/**
 * Deterministic bounded worker pool for Codex/MetaHarness fanout.
 *
 * Completion order never affects result order. The caller-supplied AbortSignal
 * and timeout cancel both queued and cooperative running work. No unbounded
 * Promise.all is used.
 */
export async function runBoundedPool<T>(
  tasks: readonly BoundedTask<T>[],
  options: { maxConcurrency: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<BoundedPoolResult<T>> {
  const started = Date.now();
  if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
    throw new Error('maxConcurrency must be a positive integer');
  }
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`duplicate or empty task id: ${task.id}`);
    ids.add(task.id);
  }
  const maxConcurrency = Math.min(options.maxConcurrency, tasks.length || 1);
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason ?? new Error('cancelled'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = options.timeoutMs && options.timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error('worker-pool-timeout')), options.timeoutMs)
    : undefined;

  const results = new Map<string, BoundedTaskResult<T>>();
  let cursor = 0;
  let active = 0;
  let peakConcurrency = 0;

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const taskIndex = cursor++;
      const task = tasks[taskIndex]!;
      if (controller.signal.aborted) {
        results.set(task.id, { id: task.id, status: 'cancelled', error: String(controller.signal.reason ?? 'cancelled') });
        continue;
      }
      active += 1;
      peakConcurrency = Math.max(peakConcurrency, active);
      let rejectOnAbort: (() => void) | undefined;
      try {
        const abort = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(controller.signal.reason ?? new Error('cancelled'));
            return;
          }
          rejectOnAbort = () => reject(controller.signal.reason ?? new Error('cancelled'));
          controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
        });
        // Promise.race enforces the caller-visible wall time even when a
        // third-party task ignores AbortSignal. Cooperative tasks should still
        // stop their underlying work when the signal fires.
        const value = await Promise.race([task.run(controller.signal), abort]);
        results.set(task.id, controller.signal.aborted
          ? { id: task.id, status: 'cancelled', error: String(controller.signal.reason ?? 'cancelled') }
          : { id: task.id, status: 'fulfilled', value });
      } catch (error) {
        results.set(task.id, {
          id: task.id,
          status: controller.signal.aborted ? 'cancelled' : 'rejected',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
        active -= 1;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  return {
    results: tasks.map((task) => results.get(task.id) ?? {
      id: task.id,
      status: 'cancelled',
      error: 'not-started',
    }),
    peakConcurrency,
    durationMs: Date.now() - started,
  };
}
