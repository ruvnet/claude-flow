# Claude-Flow Integration: Network Sandboxing & DevTools
## Advanced SDK Feature Integration for Swarm Orchestration

**Version**: 2.5.0-alpha.130
**Date**: 2025-09-30
**Status**: Design Phase

---

## 🎯 Overview

This document explores how to integrate two advanced Claude Code SDK features into Claude-Flow's swarm orchestration system:

1. **Network Request Sandboxing** - Per-agent network isolation and governance
2. **React DevTools Integration** - Real-time swarm visualization and profiling

---

## 1️⃣ Network Request Sandboxing Integration

### SDK Feature Analysis

```typescript
// Discovered in @anthropic-ai/claude-code CLI source
interface NetworkPermission {
  hostPattern: { host: string; port: number };
  allow: boolean;
  rememberForSession: boolean;
}

// Implementation pattern (inferred from minified code)
function promptNetworkAccess(
  hostPattern: { host: string; port: number }
): Promise<NetworkPermissionResponse> {
  // SDK prompts user for approval
  // Returns: { allow: boolean, rememberForSession: boolean }
}
```

**Key Capabilities**:
- ✅ Host-level network isolation
- ✅ Port-specific access control
- ✅ Session-persistent permissions
- ✅ Interactive approval flow

---

### 🚀 Claude-Flow Integration Strategy

#### **Use Case 1: Per-Agent Network Policies**

**Scenario**: Different agents need different network access levels
- Research agents → Full internet access
- Code analysis agents → GitHub API only
- Validation agents → No network access (sandboxed)

**Implementation**:

```typescript
// src/swarm/network-policy-manager.ts
import { AgentType, SwarmConfig } from './types';

interface AgentNetworkPolicy {
  agentType: AgentType;
  allowedHosts: Array<{ host: string; port: number }>;
  deniedHosts: Array<{ host: string; port: number }>;
  defaultBehavior: 'allow' | 'deny' | 'prompt';
}

export class NetworkPolicyManager {
  private policies: Map<AgentType, AgentNetworkPolicy> = new Map();

  constructor() {
    this.initializeDefaultPolicies();
  }

  private initializeDefaultPolicies() {
    // Research agent - broad access
    this.policies.set('researcher', {
      agentType: 'researcher',
      allowedHosts: [
        { host: '*.anthropic.com', port: 443 },
        { host: '*.github.com', port: 443 },
        { host: '*.stackoverflow.com', port: 443 },
        { host: '*.npmjs.com', port: 443 }
      ],
      deniedHosts: [],
      defaultBehavior: 'prompt'
    });

    // Coder agent - restricted to documentation and package registries
    this.policies.set('coder', {
      agentType: 'coder',
      allowedHosts: [
        { host: 'api.github.com', port: 443 },
        { host: 'registry.npmjs.org', port: 443 },
        { host: 'pypi.org', port: 443 }
      ],
      deniedHosts: [],
      defaultBehavior: 'deny'
    });

    // Analyst agent - no network access (sandboxed)
    this.policies.set('analyst', {
      agentType: 'analyst',
      allowedHosts: [],
      deniedHosts: [{ host: '*', port: '*' }],
      defaultBehavior: 'deny'
    });

    // Optimizer agent - metrics endpoints only
    this.policies.set('optimizer', {
      agentType: 'optimizer',
      allowedHosts: [
        { host: 'api.anthropic.com', port: 443 }
      ],
      deniedHosts: [],
      defaultBehavior: 'deny'
    });
  }

  async checkNetworkAccess(
    agentType: AgentType,
    host: string,
    port: number,
    sessionId: string
  ): Promise<{ allowed: boolean; reason: string }> {
    const policy = this.policies.get(agentType);
    if (!policy) {
      return { allowed: false, reason: 'No policy found for agent type' };
    }

    // Check explicit denials first
    if (this.isHostDenied(host, port, policy.deniedHosts)) {
      return {
        allowed: false,
        reason: `Host ${host}:${port} is explicitly denied for ${agentType} agents`
      };
    }

    // Check explicit allows
    if (this.isHostAllowed(host, port, policy.allowedHosts)) {
      return {
        allowed: true,
        reason: `Host ${host}:${port} is whitelisted for ${agentType} agents`
      };
    }

    // Apply default behavior
    switch (policy.defaultBehavior) {
      case 'allow':
        return { allowed: true, reason: 'Default allow policy' };
      case 'deny':
        return { allowed: false, reason: 'Default deny policy' };
      case 'prompt':
        // Delegate to SDK's interactive prompt
        return await this.promptUserForAccess(agentType, host, port, sessionId);
    }
  }

  private isHostAllowed(
    host: string,
    port: number,
    allowedHosts: Array<{ host: string; port: number }>
  ): boolean {
    return allowedHosts.some(pattern =>
      this.matchesPattern(host, pattern.host) &&
      (pattern.port === '*' || pattern.port === port)
    );
  }

  private isHostDenied(
    host: string,
    port: number,
    deniedHosts: Array<{ host: string; port: number }>
  ): boolean {
    return deniedHosts.some(pattern =>
      this.matchesPattern(host, pattern.host) &&
      (pattern.port === '*' || pattern.port === port)
    );
  }

  private matchesPattern(host: string, pattern: string): boolean {
    // Wildcard pattern matching
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$'
    );
    return regex.test(host);
  }

  private async promptUserForAccess(
    agentType: AgentType,
    host: string,
    port: number,
    sessionId: string
  ): Promise<{ allowed: boolean; reason: string }> {
    // Use SDK's native network prompt
    const response = await this.sdkNetworkPrompt({ host, port });

    if (response.rememberForSession) {
      // Cache decision for this session
      this.cacheSessionDecision(sessionId, host, port, response.allow);
    }

    return {
      allowed: response.allow,
      reason: response.allow
        ? `User approved access to ${host}:${port}`
        : `User denied access to ${host}:${port}`
    };
  }

  async setAgentPolicy(agentType: AgentType, policy: AgentNetworkPolicy): Promise<void> {
    this.policies.set(agentType, policy);
  }

  async getAgentPolicy(agentType: AgentType): Promise<AgentNetworkPolicy | undefined> {
    return this.policies.get(agentType);
  }
}
```

---

#### **Use Case 2: Swarm-Level Network Isolation**

**Scenario**: Entire swarm operates in restricted network environment

```typescript
// src/swarm/swarm-network-manager.ts
export class SwarmNetworkManager {
  private policyManager: NetworkPolicyManager;
  private swarmSessions: Map<string, NetworkSessionData> = new Map();

  async initializeSwarm(
    swarmId: string,
    config: SwarmNetworkConfig
  ): Promise<void> {
    this.swarmSessions.set(swarmId, {
      isolationMode: config.isolationMode,
      allowedHosts: config.allowedHosts || [],
      deniedHosts: config.deniedHosts || [],
      agentPermissions: new Map()
    });
  }

  async beforeAgentNetworkRequest(
    agentId: string,
    agentType: AgentType,
    request: NetworkRequest
  ): Promise<NetworkRequestResult> {
    const swarmId = this.getSwarmIdForAgent(agentId);
    const session = this.swarmSessions.get(swarmId);

    if (!session) {
      throw new Error(`No network session found for swarm ${swarmId}`);
    }

    // Check swarm-level restrictions first
    if (session.isolationMode === 'strict') {
      const swarmAllowed = this.isHostAllowedInSwarm(
        request.host,
        request.port,
        session
      );

      if (!swarmAllowed) {
        return {
          allowed: false,
          reason: `Swarm ${swarmId} operates in strict isolation mode`,
          blockedBy: 'swarm-policy'
        };
      }
    }

    // Check agent-level policy
    const agentCheck = await this.policyManager.checkNetworkAccess(
      agentType,
      request.host,
      request.port,
      agentId
    );

    if (!agentCheck.allowed) {
      return {
        allowed: false,
        reason: agentCheck.reason,
        blockedBy: 'agent-policy'
      };
    }

    // Record permission grant for audit
    this.recordNetworkAccess(swarmId, agentId, request);

    return {
      allowed: true,
      reason: 'Approved by swarm and agent policies'
    };
  }

  async getSwarmNetworkAudit(swarmId: string): Promise<NetworkAuditLog> {
    // Return complete audit trail of network requests
    return {
      swarmId,
      totalRequests: this.getTotalRequests(swarmId),
      approvedRequests: this.getApprovedRequests(swarmId),
      deniedRequests: this.getDeniedRequests(swarmId),
      requestsByAgent: this.getRequestsByAgent(swarmId),
      requestsByHost: this.getRequestsByHost(swarmId)
    };
  }
}
```

---

#### **Use Case 3: Dynamic Network Policy Updates**

**Scenario**: Adjust network policies based on swarm behavior

```typescript
// src/swarm/adaptive-network-policy.ts
export class AdaptiveNetworkPolicy {
  async analyzeSwarmBehavior(swarmId: string): Promise<PolicyRecommendations> {
    const audit = await this.networkManager.getSwarmNetworkAudit(swarmId);

    const recommendations: PolicyRecommendations = {
      expansions: [],
      restrictions: [],
      warnings: []
    };

    // Detect patterns of denied requests
    const frequentlyDenied = this.findFrequentlyDeniedHosts(audit);
    if (frequentlyDenied.length > 0) {
      recommendations.warnings.push({
        type: 'frequent-denials',
        hosts: frequentlyDenied,
        suggestion: 'Consider adding these hosts to allowlist if trusted'
      });
    }

    // Detect suspicious network patterns
    const suspiciousActivity = this.detectSuspiciousPatterns(audit);
    if (suspiciousActivity.length > 0) {
      recommendations.restrictions.push({
        type: 'suspicious-activity',
        details: suspiciousActivity,
        action: 'Recommend restricting network access for affected agents'
      });
    }

    return recommendations;
  }

  private detectSuspiciousPatterns(audit: NetworkAuditLog): SuspiciousPattern[] {
    const patterns: SuspiciousPattern[] = [];

    // Port scanning detection
    const portScans = this.detectPortScanning(audit);
    if (portScans.length > 0) {
      patterns.push({
        type: 'port-scan',
        agents: portScans,
        severity: 'high'
      });
    }

    // Unusual TLD access
    const unusualTLDs = this.detectUnusualTLDs(audit);
    if (unusualTLDs.length > 0) {
      patterns.push({
        type: 'unusual-tld',
        hosts: unusualTLDs,
        severity: 'medium'
      });
    }

    return patterns;
  }
}
```

---

## 2️⃣ React DevTools Integration

### SDK Feature Analysis

```typescript
// Discovered in @anthropic-ai/claude-code CLI source
window.__REACT_DEVTOOLS_COMPONENT_FILTERS__

// SDK includes full React DevTools backend for TUI rendering
// React Fiber profiling
// Component tree inspection
// Performance timeline tracking
```

**Key Capabilities**:
- ✅ Real-time component tree visualization
- ✅ Performance profiling (render times, re-renders)
- ✅ State inspection
- ✅ Props tracking
- ✅ Timeline analysis

---

### 🚀 Claude-Flow Integration Strategy

#### **Use Case 1: Swarm Visualization Dashboard**

**Scenario**: Real-time visualization of swarm topology and agent states

```typescript
// src/ui/swarm-devtools.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';

interface SwarmNode {
  id: string;
  type: string;
  status: 'idle' | 'busy' | 'failed';
  connections: string[];
  metrics: {
    tasksCompleted: number;
    avgExecutionTime: number;
    errorRate: number;
  };
}

export const SwarmDevToolsDashboard: React.FC<{
  swarmId: string;
}> = ({ swarmId }) => {
  const [topology, setTopology] = useState<SwarmNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to swarm state updates
    const unsubscribe = SwarmMonitor.subscribe(swarmId, (state) => {
      setTopology(state.agents);
    });

    return unsubscribe;
  }, [swarmId]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan">
        <Text bold color="cyan">
          🐝 Swarm Topology: {swarmId}
        </Text>
      </Box>

      <Box flexDirection="row" marginTop={1}>
        {/* Agent Grid */}
        <Box flexDirection="column" width="50%">
          {topology.map((node) => (
            <AgentCard
              key={node.id}
              node={node}
              selected={selectedNode === node.id}
              onSelect={() => setSelectedNode(node.id)}
            />
          ))}
        </Box>

        {/* Agent Details Panel */}
        <Box flexDirection="column" width="50%" paddingLeft={2}>
          {selectedNode && (
            <AgentDetailsPanel
              node={topology.find((n) => n.id === selectedNode)!}
            />
          )}
        </Box>
      </Box>

      {/* Network Graph Visualization */}
      <Box marginTop={2}>
        <SwarmNetworkGraph topology={topology} />
      </Box>
    </Box>
  );
};
```

---

#### **Use Case 2: Agent Performance Profiling**

**Scenario**: Profile individual agent performance using React Fiber data

```typescript
// src/profiling/agent-profiler.ts
export class AgentProfiler {
  private fiberData: Map<string, FiberPerformanceData> = new Map();

  async captureAgentProfile(agentId: string): Promise<AgentProfile> {
    // Hook into React DevTools profiling API
    const profiler = this.getReactProfiler();

    // Start profiling
    profiler.startProfiling();

    // Let agent execute
    await this.executeAgentTasks(agentId);

    // Stop and collect data
    const profilingData = profiler.stopProfiling();

    return this.analyzeProfilingData(agentId, profilingData);
  }

  private analyzeProfilingData(
    agentId: string,
    data: ReactProfilingData
  ): AgentProfile {
    return {
      agentId,
      totalRenderTime: data.commitTime,
      componentBreakdown: data.durations.map(([id, duration]) => ({
        component: this.getComponentName(id),
        renderTime: duration,
        percentage: (duration / data.commitTime) * 100
      })),
      slowestComponents: this.findSlowestComponents(data),
      renderCount: data.durations.length,
      recommendations: this.generateOptimizationRecommendations(data)
    };
  }

  private generateOptimizationRecommendations(
    data: ReactProfilingData
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Detect unnecessary re-renders
    const unnecessaryRerenders = this.detectUnnecessaryRerenders(data);
    if (unnecessaryRerenders.length > 0) {
      recommendations.push({
        type: 'unnecessary-rerenders',
        severity: 'medium',
        components: unnecessaryRerenders,
        suggestion: 'Add React.memo or useMemo to prevent unnecessary renders'
      });
    }

    // Detect expensive computations
    const expensiveComputations = this.detectExpensiveComputations(data);
    if (expensiveComputations.length > 0) {
      recommendations.push({
        type: 'expensive-computations',
        severity: 'high',
        components: expensiveComputations,
        suggestion: 'Move expensive computations to useMemo or worker threads'
      });
    }

    return recommendations;
  }
}
```

---

#### **Use Case 3: Real-Time Swarm Monitoring UI**

**Scenario**: Live dashboard showing all swarm activity

```typescript
// src/ui/swarm-monitor.tsx
export const SwarmMonitorUI: React.FC = () => {
  const [swarms, setSwarms] = useState<SwarmState[]>([]);
  const [metrics, setMetrics] = useState<SwarmMetrics>({});

  useEffect(() => {
    // Enable React DevTools bridge
    if (typeof window !== 'undefined') {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        inject: (renderer) => {
          // Hook into React renderer for swarm components
          this.interceptSwarmComponents(renderer);
        }
      };
    }

    // Subscribe to swarm updates
    const unsubscribe = SwarmCoordinator.subscribeToAll((updates) => {
      setSwarms(updates.swarms);
      setMetrics(updates.metrics);
    });

    return unsubscribe;
  }, []);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="double" borderColor="green">
        <Text bold color="green">
          🌊 Claude-Flow Swarm Monitor v2.5.0
        </Text>
      </Box>

      {/* Active Swarms Grid */}
      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
        {swarms.map((swarm) => (
          <SwarmCard
            key={swarm.id}
            swarm={swarm}
            metrics={metrics[swarm.id]}
          />
        ))}
      </Box>

      {/* Global Metrics */}
      <Box marginTop={2} borderStyle="single" borderColor="cyan">
        <GlobalMetricsPanel metrics={this.aggregateMetrics(metrics)} />
      </Box>

      {/* Performance Timeline */}
      <Box marginTop={2}>
        <PerformanceTimeline swarms={swarms} />
      </Box>
    </Box>
  );
};
```

---

## 🔧 Implementation Plan

### Phase 1: Network Sandboxing (Week 1)
1. Create `NetworkPolicyManager` class
2. Implement per-agent network policies
3. Add SDK network prompt integration
4. Create swarm-level network isolation
5. Build network audit logging

### Phase 2: React DevTools Bridge (Week 2)
1. Set up React DevTools hook integration
2. Create swarm visualization components
3. Implement agent profiling system
4. Build real-time monitoring dashboard
5. Add performance recommendations

### Phase 3: Integration & Testing (Week 3)
1. Integrate with existing swarm coordinator
2. Add configuration options
3. Create comprehensive test suite
4. Performance benchmarking
5. Documentation

---

## 📊 Expected Benefits

### Network Sandboxing
- ✅ **Security**: Prevent unauthorized network access by agents
- ✅ **Compliance**: Audit trail for all network requests
- ✅ **Control**: Fine-grained per-agent network policies
- ✅ **Visibility**: Real-time monitoring of network activity

### React DevTools Integration
- ✅ **Monitoring**: Real-time swarm state visualization
- ✅ **Debugging**: Component-level agent inspection
- ✅ **Performance**: Identify bottlenecks in agent execution
- ✅ **Optimization**: Data-driven performance improvements

---

## 🎯 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Network Policy Violations | 0 | Audit log analysis |
| Dashboard Render Performance | <16ms | React DevTools profiler |
| Agent Profile Collection Overhead | <5% | Benchmark comparison |
| Network Request Latency | <2ms added | Performance tests |

---

## 📝 Configuration Examples

### Network Policy Configuration
```typescript
// claude-flow.config.ts
export default {
  swarm: {
    networkPolicies: {
      researcher: {
        allowedHosts: ['*.github.com', '*.stackoverflow.com'],
        defaultBehavior: 'prompt'
      },
      coder: {
        allowedHosts: ['registry.npmjs.org', 'pypi.org'],
        defaultBehavior: 'deny'
      },
      analyst: {
        allowedHosts: [],
        defaultBehavior: 'deny' // Fully sandboxed
      }
    },
    networkIsolation: {
      mode: 'strict', // 'strict' | 'permissive' | 'audit-only'
      allowedGlobalHosts: ['api.anthropic.com']
    }
  },
  devTools: {
    enabled: true,
    dashboard: {
      port: 3000,
      enableProfiling: true,
      updateInterval: 1000
    }
  }
};
```

---

*Integration design for Claude-Flow v2.5.0-alpha.130*