# GitHub Issue Templates

This directory contains ready-to-use GitHub issue templates for documenting fixes and features.

## Available Templates

### WSL ENOTEMPTY Automatic Recovery

**File**: `wsl-enotempty-automatic-recovery.md`

**Purpose**: Document the automatic error recovery implementation for WSL better-sqlite3 ENOTEMPTY errors

**Usage**:
```bash
# Automated (requires gh CLI)
bash scripts/create-github-issue.sh

# Manual
1. Go to https://github.com/ruvnet/claude-flow/issues/new
2. Copy content from: docs/github-issues/wsl-enotempty-automatic-recovery.md
3. Paste into issue body
4. Add labels: enhancement, bug-fix, wsl, user-experience, v2.7.35
5. Set milestone: v2.7.35
6. Submit
```

**Before Submitting**:
- [x] ✅ Confirm fix works in Docker (DONE - 100% pass rate)
- [x] ✅ Update test results section with actual data (DONE)
- [ ] Add screenshots if available
- [ ] Review and customize template as needed

---

## Test Results Summary

### Docker Tests Completed ✅

| Test | Status | Date |
|------|--------|------|
| Ubuntu 22.04 Clean Install | ✅ PASS | 2025-11-13 |
| Debian 12 Cross-Distro | ✅ PASS | 2025-11-13 |
| Corrupted Cache Recovery | ✅ PASS | 2025-11-13 |
| Overall Success Rate | 100% | 2025-11-13 |

**Details**: See `docs/DOCKER_TEST_RESULTS_v2.7.35.md`

---

## Quick Reference

### Issue Creation Checklist

- [ ] Tests passing (100%)
- [ ] Documentation updated
- [ ] Changelog entry prepared
- [ ] Screenshots captured (optional)
- [ ] Test results in template
- [ ] Labels assigned
- [ ] Milestone set
- [ ] Reviewers assigned

### Recommended Labels

- `enhancement` - New feature or improvement
- `bug-fix` - Fixes an existing issue
- `wsl` - WSL-specific
- `user-experience` - Improves UX
- `v2.7.35` - Version tag

### Recommended Milestone

- **v2.7.35** - Automatic Error Recovery Release

---

## Related Documentation

- [Implementation Summary](../AUTOMATIC_ERROR_RECOVERY_v2.7.35.md)
- [Docker Test Results](../DOCKER_TEST_RESULTS_v2.7.35.md)
- [Confirmation Document](../CONFIRMATION_AUTOMATIC_ERROR_RECOVERY.md)
- [Feature Documentation](../features/automatic-error-recovery.md)
- [Troubleshooting Guide](../troubleshooting/wsl-better-sqlite3-error.md)

---

**Last Updated**: 2025-11-13
**Status**: Ready for GitHub issue creation ✅
