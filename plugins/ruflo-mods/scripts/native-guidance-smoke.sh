#!/usr/bin/env bash
# Focused real engine contracts with explicit feature configuration.
# 2.1.283 ignores the newer testing kit's per-test options. A disposable copy
# enables the feature at registration; every hook implementation stays intact.
# This proves configured native contracts, not the complete native suite.
set -euo pipefail
plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/ruflo-guidance-native.XXXXXX")"
trap 'rm -rf "$fixture_root"' EXIT
python3 - "$plugin_root" "$fixture_root/plugin" <<'PY'
from pathlib import Path
import shutil
import sys

source, fixture = map(Path, sys.argv[1:])
shutil.copytree(source, fixture)
for test in (fixture / 'tests').glob('*.test.ts'):
    if test.name != 'guidance.test.ts':
        test.unlink()

test = fixture / 'tests/guidance.test.ts'
text = test.read_text()
marker = "  test('default settings"
assert text.count(marker) == 1, 'Expected the separate default settings contract'
test.write_text(text[:text.index(marker)] + '})\n')

register = fixture / 'hooks/register.ts'
text = register.read_text()
marker = 'readOptions(options)'
assert text.count(marker) == 1, 'Expected the production options injection point'
register.write_text(text.replace(marker, 'readOptions({ ...options, guidanceContext: true, guidanceLearning: true, routeContext: false })'))
print('Configured native guidance fixture: three feature contracts; no hook implementation changed.')
PY
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 "${RUFLO_NATIVE_TEST_CLAUDE:-claude}" plugin test "$fixture_root/plugin"
