export type NativePlugin<Stats extends object> = {
  name: string;
  writers: readonly string[];
  verdict(tool: string, input: unknown): string | undefined;
  newStats(): Stats;
  statusPath: string;
  statusText(stats: Stats, now: number): string;
  answer: Function;
  count(stats: Stats, tool: string, input: unknown, reason: string | undefined): void;
};
export function runCodexHook<Stats extends object>(plugin: NativePlugin<Stats>): Promise<void>;
export function hookFailure(plugin: string): void;
