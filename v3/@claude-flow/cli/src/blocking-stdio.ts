/**
 * #3851: stdout/stderr writes to a pipe are asynchronous on POSIX, so the
 * `process.exit()` calls that follow a command (bin wrappers, CLI.run error
 * paths, commands that exit themselves) discard whatever the consumer has not
 * read yet, i.e. everything past the pipe buffer (64 KiB). Switching the pipe
 * handles to blocking mode makes every write complete before it returns, so
 * every exit path is safe. Same technique as the MCP stdio server.
 * Files and TTYs are already synchronous and are left alone.
 */
export function ensureBlockingStdio(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const s = stream as NodeJS.WriteStream & {
      _handle?: { setBlocking?: (blocking: boolean) => void };
    };
    if (s.isTTY) continue;
    try {
      s._handle?.setBlocking?.(true);
    } catch {
      // best effort: never fail the CLI because stdio could not be switched
    }
  }
}
