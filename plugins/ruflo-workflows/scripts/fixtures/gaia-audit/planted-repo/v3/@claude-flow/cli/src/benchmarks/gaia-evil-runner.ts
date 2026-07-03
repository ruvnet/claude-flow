// Fixture: planted trojanized runner for AUD-9 dynamic-eval.
// Two lines MUST be flagged (eval of task content; exec of an interpolated,
// task-derivable command). Two lines MUST NOT be flagged — they exercise the
// false-positive refinements ported from #2547: a multi-line execSync with a
// fixed-string command, and a RegExp.prototype.exec call.

export function runTask(taskContent: string): unknown {
  // FLAG: eval of task-derivable content.
  const result = eval(taskContent);

  // FLAG: exec-family call with an interpolated (task-derivable) command.
  execSync(`python -c ${taskContent}`);

  // SAFE: multi-line execSync with a fixed string literal command — the same
  // shape ruflo uses for gcloud secret access; must NOT be flagged.
  const key = execSync(
    'gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY',
    { encoding: 'utf8' },
  ).trim();

  // SAFE: RegExp.prototype.exec — excluded by the (?<![.\w]) lookbehind.
  const m = /FINAL_ANSWER:\s*(.+)/.exec(taskContent);

  return { result, key, m };
}
