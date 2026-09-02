# Documentation - Technical References

This folder contains technical documentation and status reports for the ReasoningBank models project.

## Files in This Directory

### Schema & Compatibility

- **[COMPATIBILITY.md](./COMPATIBILITY.md)** - Complete schema reference
  - All 12 table schemas documented
  - Usage examples for each table
  - API integration examples (JavaScript, Python)
  - Troubleshooting guide
  - Performance characteristics

### Project Status

- **[COMPLETION-SUMMARY.md](./COMPLETION-SUMMARY.md)** - Full project completion report
  - Training results for all 5 models
  - Quality metrics and benchmarks
  - Deliverables checklist
  - Achievement summary

- **[SCHEMA-UPDATE-SUMMARY.md](./SCHEMA-UPDATE-SUMMARY.md)** - Schema update details
  - What changed (4-8 tables → 12 tables)
  - New capabilities added
  - Migration guide
  - Before/after comparison

- **[VERIFICATION-COMPLETE.md](./VERIFICATION-COMPLETE.md)** - Final verification status
  - All tests passed
  - Data integrity confirmed
  - Compatibility verified
  - Performance validated

## Quick Links

### For Users

- [Model Catalog](../README.md) - Choose and install a model
- [How to Use Models](../HOW-TO-USE.md) - Installation and usage
- [Schema Reference](./COMPATIBILITY.md) - Database tables and commands

### For Developers

- [How to Train Models](../HOW-TO-TRAIN.md) - Create custom models
- [Scripts Reference](../_scripts/README.md) - Utility scripts
- [Completion Summary](./COMPLETION-SUMMARY.md) - Technical details

### For Researchers

- [Google Research Paper](../../google-research.md) - arXiv:2509.25140
- [Architecture Details](../../architecture.md) - Technical deep-dive
- [Completion Summary](./COMPLETION-SUMMARY.md) - Training methodology

## Navigation

```
models/
├── _docs/              ← You are here (technical docs)
│   ├── COMPATIBILITY.md
│   ├── COMPLETION-SUMMARY.md
│   ├── SCHEMA-UPDATE-SUMMARY.md
│   └── VERIFICATION-COMPLETE.md
├── _scripts/           ← Utility scripts
├── safla/              ← Model: SAFLA (2,000 patterns)
├── google-research/    ← Model: Google Research (3,000 patterns)
├── code-reasoning/     ← Model: Code Reasoning (2,500 patterns)
├── problem-solving/    ← Model: Problem Solving (2,000 patterns)
├── domain-expert/      ← Model: Domain Expert (1,500 patterns)
├── README.md           ← Start here!
├── HOW-TO-USE.md       ← Usage guide
├── HOW-TO-TRAIN.md     ← Training guide
└── INDEX.md            ← Complete index
```

---

**Last Updated**: 2025-10-15
**Purpose**: Technical documentation and project status
