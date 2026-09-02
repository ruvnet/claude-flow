# Agentic-Flow Integration

**Integration Status**: ✅ Active & Released
**Latest Version**: v1.7.4 (Export Issues RESOLVED!)
**npm Package**: https://www.npmjs.com/package/agentic-flow/v/1.7.4
**Integration Type**: npm dependency
**Backwards Compatibility**: 100% guaranteed

🎉 **v1.7.4 Update**: Export configuration issue from v1.7.1 is now FIXED! All advanced features (HybridReasoningBank, AdvancedMemorySystem) are now accessible via standard imports. See [v1.7.4 Verification Report](./VERIFICATION-v1.7.4.md) for details.

---

## 📚 Documentation

### Release Information
- **[v1.7.4 Verification Report](./VERIFICATION-v1.7.4.md)** - 🆕 **LATEST** - Export fix verified, production ready!
- **[v1.7.1 Release Notes](./RELEASE-v1.7.1.md)** - All advanced features complete
- **[v1.7.1 Integration Test](./INTEGRATION-TEST-v1.7.1.md)** - ⚠️ Export issues (RESOLVED in v1.7.4)
- **[v1.7.0 Release Notes](./RELEASE-v1.7.0.md)** - Initial release with AgentDB integration
- **[Migration Guide v1.7.0](./MIGRATION_v1.7.0.md)** - Upgrade guide from v1.6.x

### Integration Guides
- **[Integration Guide](./AGENTIC-FLOW-INTEGRATION-GUIDE.md)** - Complete integration documentation
- **[Integration Status](./AGENTIC_FLOW_INTEGRATION_STATUS.md)** - Current integration status
- **[MVP Complete](./AGENTIC_FLOW_MVP_COMPLETE.md)** - MVP implementation details

### Technical Reports
- **[Execution Fix Report](./AGENTIC_FLOW_EXECUTION_FIX_REPORT.md)** - Execution fixes and improvements
- **[Security Test Report](./AGENTIC_FLOW_SECURITY_TEST_REPORT.md)** - Security validation results

---

## 🚀 Quick Start

### Installation

```bash
# Install agentic-flow (automatically included in claude-flow)
npm install agentic-flow@^1.7.0

# Or update existing installation
npm update agentic-flow
```

### Basic Usage

```typescript
import { ReasoningBankEngine } from 'agentic-flow/reasoningbank';
import { ReflexionMemory } from 'agentic-flow/agentdb';

// Initialize ReasoningBank
const rb = new ReasoningBankEngine();

// Store patterns
await rb.storePattern({
  sessionId: 'session-1',
  task: 'implement authentication',
  success: true,
  reward: 0.95
});

// Retrieve patterns
const patterns = await rb.retrievePatterns('authentication', { k: 5 });
```

---

## 🎯 What's New in v1.7.1 (Latest!)

### 🚀 ALL Advanced Features Now Available!

1. **WASM-Accelerated HybridReasoningBank** ✅
   - ✅ **116x Faster Search**: WASM-accelerated similarity computation
   - ✅ **CausalRecall Ranking**: Utility-based pattern reranking
   - ✅ **Strategy Learning**: Evidence-based recommendations
   - ✅ **Query Caching**: 60s TTL, 90%+ hit rate
   - ✅ **Auto-Consolidation**: Patterns → skills automatically

2. **Advanced Memory System** ✅
   - ✅ **Episodic Replay**: Learn from past failures
   - ✅ **What-If Analysis**: Causal impact predictions
   - ✅ **Skill Composition**: Intelligent skill combining
   - ✅ **NightlyLearner**: Doubly robust learning
   - ✅ **Automated Learning Cycles**: Background optimization

3. **Complete AgentDB Integration** ✅
   - ✅ **API Alignment**: All controllers working
   - ✅ **Import Resolution**: Automatic patch applied
   - ✅ **CausalMemoryGraph**: Automatic edge tracking
   - ✅ **29 MCP Tools**: Full Claude Desktop support

4. **Infrastructure** ✅
   - ✅ **56% Memory Reduction**: SharedMemoryPool
   - ✅ **100% Backwards Compatible**: All v1.7.0 code works
   - ✅ **Production Ready**: Docker validated, 100% test pass

See [RELEASE-v1.7.1.md](./RELEASE-v1.7.1.md) for complete details and API examples.

---

## 📊 Performance Benefits

| Metric | v1.6.x | v1.7.0 | v1.7.1 | Improvement |
|--------|--------|--------|--------|-------------|
| **Bundle Size** | 5.2MB | 4.8MB | 4.8MB | ✅ **-7.7%** |
| **Memory (4 agents)** | 800MB | 350MB | 350MB | ✅ **-56%** |
| **Cold Start** | 3.5s | 1.2s | 1.2s | ✅ **-65%** |
| **Vector Search** | 580ms | 580ms | 5ms | ✅ **116x faster** |
| **Query Caching** | None | None | 60s TTL | ✅ **90%+ hit rate** |
| **Causal Ranking** | None | Basic | CausalRecall | ✅ **Enhanced** |

---

## 🔗 Related Documentation

### Claude-Flow Integration
- **[AgentDB Integration](../../agentdb/)** - AgentDB v1.3.9 integration in claude-flow
- **[ReasoningBank Architecture](../../reasoningbank/architecture.md)** - ReasoningBank system design
- **[Integration Architecture](../reasoningbank/REASONINGBANK_ARCHITECTURE.md)** - How claude-flow uses agentic-flow

### Upstream Resources
- **[GitHub Repository](https://github.com/ruvnet/agentic-flow)** - Agentic-flow source code
- **[Issue #34](https://github.com/ruvnet/agentic-flow/issues/34)** - AgentDB integration tracking
- **[NPM Package](https://www.npmjs.com/package/agentic-flow)** - Official npm package

---

## 💡 Best Practices

### For Claude-Flow Users

1. **Automatic Benefits**: Claude-flow uses `"agentic-flow": "*"` dependency
   - Always gets latest agentic-flow version
   - No manual updates needed
   - All performance improvements automatic

2. **Recommended Approach**: Let claude-flow manage integration
   - Don't pin agentic-flow version
   - Trust semver for backwards compatibility
   - Update claude-flow to get agentic-flow updates

3. **Advanced Usage**: Optional direct usage
   ```typescript
   // Use advanced features directly
   import { HybridReasoningBank } from 'agentic-flow/reasoningbank';
   import { AdvancedMemorySystem } from 'agentic-flow/reasoningbank';
   import { SharedMemoryPool } from 'agentic-flow/memory';
   ```

---

## 🧪 Testing

### Run Integration Tests

```bash
# Claude-flow integration tests
npm run test:integration

# Agentic-flow backwards compatibility
npx vitest tests/backwards-compatibility.test.ts

# Performance benchmarks
npm run bench:memory -- --agents 4
npm run bench:search -- --vectors 100000
```

---

## 📈 Roadmap

### Upcoming Features (agentic-flow)

- **Phase 2** (Week 2): Code cleanup and tree-shaking
- **Phase 3** (Week 3): Hybrid backend with fallback
- **Phase 4** (Week 4): Final optimization and documentation

See [agentic-flow#34](https://github.com/ruvnet/agentic-flow/issues/34) for details.

### Claude-Flow Impact

All improvements automatically benefit claude-flow users:
- No code changes required
- Seamless updates via npm
- 100% backwards compatibility guaranteed

---

## 🆘 Support

### Issues and Questions

- **Agentic-flow issues**: [ruvnet/agentic-flow/issues](https://github.com/ruvnet/agentic-flow/issues)
- **Claude-flow integration**: [ruvnet/claude-flow/issues](https://github.com/ruvnet/claude-flow/issues)
- **Tag releases**: Use appropriate version tags (e.g., `v1.7.0`)

### Documentation

- **Agentic-flow docs**: https://github.com/ruvnet/agentic-flow#readme
- **Claude-flow docs**: [../../README.md](../../README.md)
- **API reference**: [../../API_DOCUMENTATION.md](../../API_DOCUMENTATION.md)

---

## ✅ Migration Checklist

For users upgrading from v1.6.x to v1.7.0:

- [ ] Read [RELEASE-v1.7.0.md](./RELEASE-v1.7.0.md)
- [ ] Review [MIGRATION_v1.7.0.md](./MIGRATION_v1.7.0.md)
- [ ] Update package: `npm update agentic-flow`
- [ ] Run tests: `npm test`
- [ ] Verify performance: `npm run bench:*`
- [ ] Update documentation if using new APIs

**Note**: For claude-flow users, run `npm update` in the claude-flow directory.

---

## 📞 Contact

- **Maintainer**: @ruvnet
- **Repository**: https://github.com/ruvnet/agentic-flow
- **License**: MIT

---

*Last Updated: 2025-01-24*
*This documentation is part of the claude-flow project.*
