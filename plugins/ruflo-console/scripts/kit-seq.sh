#!/usr/bin/env bash
# Runs the console's kit tests (tests/*.test.ts) one file at a time with `claude plugin test` (ADR-473).
#
# Why: `claude plugin test` runs every file in its own child at once. On a loaded machine (load average 30+) 3-8 of the
# view tests then exceed their own 5 s limits, which says nothing about the code. One file at a time they do not.
# `claude plugin test` refuses a symlinked tree as path traversal, so the plugin is COPIED into a temp dir (hooks, catalog,
# types, tsconfig, plugin.json, the test fixtures and helpers) and the test files are swapped in one by one.
#
#   scripts/kit-seq.sh                  every tests/*.test.ts
#   scripts/kit-seq.sh nav actions      only tests/nav.test.ts and tests/actions.test.ts (names, with or without .test.ts)
#
# Prints one line per file, the failing file's output, and a total; exits 1 on any failure. The temp dir is removed on exit.
set -euo pipefail

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/kit-seq.XXXXXX")"
readonly PLUGIN TMP

# Removes exactly the directory made above, and only if it is still a directory under the temp root with the expected name.
cleanup() {
  case "$TMP" in
    "${TMPDIR:-/tmp}"/kit-seq.??????) [ -d "$TMP" ] && rm -rf -- "$TMP" ;;
  esac
}
trap cleanup EXIT

command -v claude >/dev/null 2>&1 || { echo "kit-seq: the claude CLI is not on PATH" >&2; exit 2; }

cd "$PLUGIN"
mkdir -p "$TMP/.claude-plugin" "$TMP/tests"
cp -rL hooks catalog types tsconfig.json "$TMP/"
cp -L .claude-plugin/plugin.json "$TMP/.claude-plugin/"
[ -f package.json ] && cp -L package.json "$TMP/"
[ -d tests/fixtures ] && cp -rL tests/fixtures "$TMP/tests/"
# Helpers that sit beside the tests (anything that is not itself a test or a spec).
while IFS= read -r helper; do cp -L "$helper" "$TMP/tests/"; done < <(/usr/bin/find tests -maxdepth 1 -type f ! -name '*.test.ts' ! -name '*.spec.ts' | sort)

declare -a files=()
if [ "$#" -gt 0 ]; then
  for name in "$@"; do
    name="${name##*/}"; name="${name%.test.ts}"
    [ -f "tests/$name.test.ts" ] || { echo "kit-seq: no tests/$name.test.ts" >&2; exit 2; }
    files+=("tests/$name.test.ts")
  done
else
  while IFS= read -r f; do files+=("$f"); done < <(/usr/bin/find tests -maxdepth 1 -type f -name '*.test.ts' | sort)
fi

[ "${#files[@]}" -gt 0 ] || { echo "kit-seq: no kit tests found" >&2; exit 2; }

pass=0 fail=0 failed_files=0 out="$TMP/out.txt"
for f in "${files[@]}"; do
  base="$(basename "$f")"
  cp -L "$f" "$TMP/tests/$base"
  code=0
  timeout 600 claude plugin test "$TMP" >"$out" 2>&1 || code=$?
  rm -f -- "$TMP/tests/$base"

  # The runner ends with "N pass", "N fail" lines; a run that printed neither (a crash, a timeout) is a failure.
  p="$(grep -E '^ *[0-9]+ pass$' "$out" | tail -1 | grep -oE '[0-9]+' || true)"
  x="$(grep -E '^ *[0-9]+ fail$' "$out" | tail -1 | grep -oE '[0-9]+' || true)"
  p="${p:-0}"; x="${x:-0}"
  pass=$((pass + p)); fail=$((fail + x))

  if [ "$code" -eq 0 ] && [ "$x" -eq 0 ] && [ "$p" -gt 0 ]; then
    printf 'PASS  %-34s %s pass\n' "$base" "$p"
  else
    failed_files=$((failed_files + 1))
    printf 'FAIL  %-34s %s pass, %s fail, exit %s\n' "$base" "$p" "$x" "$code"
    tail -40 "$out" | sed 's/^/      /'
  fi
done

printf '\n%s files, %s pass, %s fail, %s file(s) failed\n' "${#files[@]}" "$pass" "$fail" "$failed_files"
[ "$failed_files" -eq 0 ]
