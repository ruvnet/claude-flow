# Neural Module Test Suite

Comprehensive test coverage for the V3 neural module with **106 tests** across 3 test files.

## Test Files

### 1. `sona.test.ts` (23 tests)
Tests for SONA Learning Engine integration with `@ruvector/sona`:

**Initialization (5 tests)**
- Balanced mode initialization
- Real-time mode initialization
- Research mode initialization
- Edge mode initialization
- Batch mode initialization

**Learning from Trajectories (5 tests)**
- Learning from complete trajectory
- Performance target validation (<0.05ms)
- Handling empty trajectories
- Multi-step trajectory learning
- Learning time tracking

**Adaptation (6 tests)**
- Behavior adaptation based on context
- Performance target validation (<0.1ms)
- Finding similar patterns
- Route inference from patterns
- Handling no patterns found
- Adaptation time tracking

**Mode Switching (2 tests)**
- Switching between modes
- Resetting learning state

**Statistics and Monitoring (3 tests)**
- Engine statistics retrieval
- Learning time tracking
- Adaptation time tracking

**Engine Control (2 tests)**
- Enable/disable engine
- Force learning and background ticking
- Pattern finding by embedding

---

### 2. `algorithms.test.ts` (44 tests)
Tests for reinforcement learning algorithms:

#### Q-Learning (8 tests)
- Initialization
- Q-value updates from trajectory
- Performance target (<1ms)
- Exploration rate decay
- Epsilon-greedy action selection
- Q-value retrieval
- Eligibility traces support
- Q-table pruning
- Reset functionality

#### SARSA (8 tests)
- Initialization
- SARSA rule updates
- Expected SARSA variant
- Action probability distribution
- Epsilon-greedy policy
- Eligibility traces (SARSA-lambda)
- Short trajectory handling
- Reset functionality

#### DQN (9 tests)
- Initialization
- Experience replay buffer
- DQN update mechanism
- Performance target (<10ms)
- Double DQN support
- Epsilon-greedy action selection
- Q-value retrieval
- Target network updates
- Circular buffer handling

#### PPO (7 tests)
- Initialization
- Experience collection
- PPO update with clipping
- Performance target (<10ms for small batches)
- GAE advantage computation
- Policy action sampling
- Multiple training epochs
- Buffer clearing after update

#### Decision Transformer (12 tests)
- Initialization
- Trajectory buffer management
- Incomplete trajectory handling
- Training on buffered trajectories
- Performance target (<10ms per batch)
- Return-conditioned action generation
- Causal attention masking
- Bounded trajectory buffer
- Varying trajectory lengths
- Returns-to-go computation

---

### 3. `patterns.test.ts` (39 tests)
Tests for pattern learning and ReasoningBank:

#### Pattern Extraction (9 tests)
- Initialization
- Trajectory storage
- Trajectory retrieval
- Successful trajectory judgment
- Failed trajectory judgment
- Strength identification
- Weakness identification
- Improvement suggestion generation
- Incomplete trajectory error handling

#### Memory Distillation (8 tests)
- Successful trajectory distillation
- Low-quality trajectory filtering
- Automatic judgment before distillation
- Strategy extraction
- Key learnings extraction
- Aggregate embedding computation
- Distillation performance tracking
- Memory-trajectory linking

#### Retrieval with MMR (6 tests)
- Top-k similar memory retrieval
- MMR diversity application
- Retrieval result structure
- Retrieval performance tracking
- Empty bank handling
- K parameter respect

#### Consolidation (6 tests)
- Memory deduplication
- Contradiction detection
- Pattern merging
- Old pattern pruning
- Consolidation result structure
- Consolidation event emission

#### Pattern Management (7 tests)
- Memory to pattern conversion
- Pattern evolution with new experience
- Pattern usage tracking
- Success rate updates
- Quality history maintenance (max 100)
- Pattern evolution events
- Getting all patterns

#### Event System (3 tests)
- Adding/removing event listeners
- Consolidation event emission
- Pattern evolution event emission

---

## Performance Targets

All tests validate against these performance targets:

| Operation | Target | Test Coverage |
|-----------|--------|---------------|
| SONA learn() | <0.05ms | ✓ |
| SONA adapt() | <0.1ms | ✓ |
| Q-Learning update | <1ms | ✓ |
| SARSA update | <1ms | ✓ |
| DQN update | <10ms | ✓ |
| PPO update | <10ms | ✓ |
| Decision Transformer train | <10ms | ✓ |
| ReasoningBank retrieval | <10ms | ✓ |
| ReasoningBank distillation | <10ms | ✓ |

## Running Tests

```bash
# Run all tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npm run test sona.test.ts
npm run test algorithms.test.ts
npm run test patterns.test.ts

# Watch mode
npm run test -- --watch
```

## Test Coverage Goals

- **Statements**: >80%
- **Branches**: >75%
- **Functions**: >80%
- **Lines**: >80%

## Algorithm Correctness

Tests validate core algorithm implementations:

1. **Q-Learning**: TD error computation, Q-table updates, exploration decay
2. **SARSA**: On-policy updates, expected SARSA variant, eligibility traces
3. **DQN**: Experience replay, target networks, double DQN, dueling architecture
4. **PPO**: Clipped surrogate objective, GAE, value clipping, entropy bonus
5. **Decision Transformer**: Sequence modeling, causal attention, return conditioning

## Pattern Learning Pipeline

Tests validate the 4-step ReasoningBank pipeline:

1. **RETRIEVE**: Top-k memory injection with MMR diversity (6 tests)
2. **JUDGE**: LLM-as-judge trajectory evaluation (9 tests)
3. **DISTILL**: Extract strategy memories from trajectories (8 tests)
4. **CONSOLIDATE**: Dedup, detect contradictions, prune patterns (6 tests)

## Mocking Strategy

- **@ruvector/sona**: Mocked to isolate SONA integration tests
- **All algorithms**: Pure TypeScript, no mocking needed
- **ReasoningBank**: Pure TypeScript, no mocking needed

## Notes

- Tests use Vitest for fast execution
- All tests are isolated with `beforeEach` setup
- Performance tests allow overhead for mocking/setup
- Helper functions generate realistic test trajectories
- Tests cover edge cases (empty trajectories, incomplete data, etc.)
