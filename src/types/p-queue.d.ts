declare module 'p-queue' {
  export interface Options {
    concurrency?: number;
    timeout?: number;
    throwOnTimeout?: boolean;
    autoStart?: boolean;
    queueClass?: new () => Queue;
    intervalCap?: number;
    interval?: number;
    carryoverConcurrencyCount?: boolean;
  }

  export interface Queue {
    enqueue(run: () => void, options?: Partial<Options>): void;
    dequeue(): (() => void) | undefined;
    clear(): void;
    filter(options: Partial<Options>): void;
  }

  export default class PQueue {
    constructor(options?: Options);
    readonly size: number;
    readonly pending: number;
    add<T>(fn: () => Promise<T> | T, options?: Partial<Options>): Promise<T>;
    addAll<T>(fns: Array<() => Promise<T> | T>, options?: Partial<Options>): Promise<T[]>;
    onEmpty(): Promise<void>;
    onIdle(): Promise<void>;
    clear(): void;
    start(): this;
    pause(): void;
  }
}