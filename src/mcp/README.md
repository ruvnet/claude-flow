# MCP (Model Context Protocol) Implementation

This directory contains a comprehensive implementation of the Model Context Protocol (MCP) for Claude-Flow, providing robust server lifecycle management, tool registration and discovery, protocol version negotiation, security, performance monitoring, and integration with the broader orchestration system.

## Overview

The MCP implementation provides:

- **Server Lifecycle Management**: Start, stop, restart, and health monitoring
- **Tool Registry**: Registration, discovery, and capability negotiation
- **Protocol Management**: Version compatibility checking and negotiation
- **Security**: Authentication, authorization, and session management
- **Performance Monitoring**: Real-time metrics, alerting, and optimization suggestions
- **Orchestration Integration**: Seamless integration with Claude-Flow components

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                MCP Orchestration Integration                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Lifecycle Mgr   │  │ Performance Mon │  │ Protocol Mgr    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   MCP Server    │  │  Tool Registry  │  │  Auth Manager   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Request Router  │  │ Session Manager │  │ Load Balancer   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Stdio Transport │  │ HTTP Transport  │  │ WebSocket (TBD) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. MCP Server (`server.ts`)

The main MCP server implementation providing:
- Protocol-compliant request/response handling
- Tool execution and management
- Session management
- Health status reporting
- Integration with orchestration components

```typescript
import { MCPServer } from './mcp/server.js';

const server = new MCPServer(config, eventBus, logger);
await server.start();
```

### 2. Lifecycle Manager (`lifecycle-manager.ts`)

Manages server lifecycle with robust error handling:
- State management (stopped, starting, running, stopping, error)
- Health monitoring with configurable intervals
- Auto-restart with exponential backoff
- Graceful shutdown with timeout
- Event emission for state changes

```typescript
import { MCPLifecycleManager } from './mcp/lifecycle-manager.js';

const lifecycle = new MCPLifecycleManager(config, logger, serverFactory);
await lifecycle.start();
```

### 3. Tool Registry (`tools.ts`)

Enhanced tool registration and discovery:
- Capability-based tool registration
- Tool discovery by category, tags, and permissions
- Metrics tracking (invocations, success rate, execution time)
- Protocol version compatibility checking
- Input validation with JSON Schema

```typescript
import { ToolRegistry } from './mcp/tools.js';

const registry = new ToolRegistry(logger);
registry.register(tool, capability);
const tools = registry.discoverTools({ category: 'filesystem' });
```

### 4. Protocol Manager (`protocol-manager.ts`)

Handles protocol version negotiation:
- Version compatibility checking
- Capability negotiation
- Feature support detection
- Deprecation warnings
- Migration guidance

```typescript
import { MCPProtocolManager } from './mcp/protocol-manager.js';

const protocolManager = new MCPProtocolManager(logger);
const result = await protocolManager.negotiateProtocol(clientParams);
```

### 5. Authentication Manager (`auth.ts`)

Comprehensive security implementation:
- Multiple auth methods (token, basic, OAuth)
- Session management with timeouts
- Permission-based authorization
- Rate limiting and brute force protection
- Token refresh and revocation

```typescript
import { AuthManager } from './mcp/auth.js';

const auth = new AuthManager(authConfig, logger);
const result = await auth.authenticate(request, session, context);
```

### 6. Performance Monitor (`performance-monitor.ts`)

Real-time performance monitoring:
- Request/response time tracking
- Percentile calculations (P50, P95, P99)
- Custom alerting rules
- Optimization suggestions
- Resource usage monitoring

```typescript
import { MCPPerformanceMonitor } from './mcp/performance-monitor.js';

const monitor = new MCPPerformanceMonitor(logger);
const requestId = monitor.recordRequestStart(request, session);
monitor.recordRequestEnd(requestId, response);
```

### 7. Orchestration Integration (`orchestration-integration.ts`)

Seamless integration with Claude-Flow:
- Component health monitoring
- Tool registration for orchestration features
- Event forwarding and coordination
- Reconnection logic with exponential backoff
- Cross-component communication

```typescript
import { MCPOrchestrationIntegration } from './mcp/orchestration-integration.js';

const integration = new MCPOrchestrationIntegration(
  mcpConfig,
  orchestrationConfig,
  components,
  logger
);
await integration.start();
```

## Quick Start

### Basic Server Setup

```typescript
import { MCPIntegrationFactory } from './mcp/index.js';

// Development setup
const { server, lifecycleManager, performanceMonitor } = 
  await MCPIntegrationFactory.createDevelopmentSetup(logger);

await lifecycleManager.start();
```

### Full Integration Setup

```typescript
import { MCPOrchestrationIntegration } from './mcp/orchestration-integration.js';

const integration = new MCPOrchestrationIntegration(
  mcpConfig,
  {
    enabledIntegrations: {
      orchestrator: true,
      swarm: true,
      agents: true,
      resources: true,
      memory: true,
      monitoring: true,
      terminals: true,
    },
    autoStart: true,
    enableMetrics: true,
    enableAlerts: true,
  },
  {
    orchestrator,
    swarmCoordinator,
    agentManager,
    resourceManager,
    memoryManager,
    messageBus,
    monitor,
    eventBus,
    terminalManager,
  },
  logger
);

await integration.start();
```

### Tool Registration

```typescript
// Register a simple tool
server.registerTool({
  name: 'filesystem/read',
  description: 'Read file contents',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
    required: ['path'],
  },
  handler: async (input) => {
    const { path } = input as { path: string };
    return await fs.readFile(path, 'utf-8');
  },
});

// Register with enhanced capabilities
const toolRegistry = new ToolRegistry(logger);
toolRegistry.register(tool, {
  name: 'filesystem/read',
  version: '1.0.0',
  description: 'Read file contents with encoding support',
  category: 'filesystem',
  tags: ['file', 'read', 'io'],
  supportedProtocolVersions: [{ major: 2024, minor: 11, patch: 5 }],
  requiredPermissions: ['filesystem.read'],
});
```

## Configuration

### MCP Config

```typescript
const mcpConfig: MCPConfig = {
  transport: 'http',
  host: '0.0.0.0',
  port: 3000,
  tlsEnabled: true,
  enableMetrics: true,
  auth: {
    enabled: true,
    method: 'token',
    tokens: ['secure-token-here'],
    users: [
      {
        username: 'admin',
        password: 'hashed-password',
        permissions: ['*'],
        roles: ['admin'],
      },
    ],
  },
  loadBalancer: {
    enabled: true,
    maxRequestsPerSecond: 100,
    maxConcurrentRequests: 50,
  },
  sessionTimeout: 3600000, // 1 hour
  maxSessions: 1000,
};
```

### Orchestration Config

```typescript
const orchestrationConfig: MCPOrchestrationConfig = {
  enabledIntegrations: {
    orchestrator: true,
    swarm: true,
    agents: true,
    resources: true,
    memory: true,
    monitoring: true,
    terminals: true,
  },
  autoStart: true,
  healthCheckInterval: 30000,
  reconnectAttempts: 3,
  reconnectDelay: 5000,
  enableMetrics: true,
  enableAlerts: true,
};
```

## Monitoring and Alerting

### Performance Metrics

The performance monitor tracks:
- Request count and success rate
- Response time percentiles (P50, P95, P99)
- Throughput (requests per second)
- Memory and CPU usage
- Error rates by category

### Custom Alerts

```typescript
performanceMonitor.addAlertRule({
  id: 'high_latency',
  name: 'High Response Time',
  metric: 'p95ResponseTime',
  operator: 'gt',
  threshold: 5000, // 5 seconds
  duration: 60000, // 1 minute
  enabled: true,
  severity: 'high',
  actions: ['log', 'notify', 'escalate'],
});
```

### Optimization Suggestions

The system automatically generates optimization suggestions based on:
- Response time patterns
- Memory usage trends
- Throughput bottlenecks
- Error rate analysis

## Security Features

### Authentication Methods

1. **Token Authentication**: Static or generated tokens
2. **Basic Authentication**: Username/password with bcrypt hashing
3. **OAuth**: JWT token validation (extensible)

### Authorization

- Permission-based access control
- Role-based authorization
- Tool-specific permissions
- Session-based authorization

### Security Measures

- Rate limiting with exponential backoff
- Brute force protection
- Token expiration and refresh
- Session timeout management
- Input validation and sanitization

## Error Handling

### Reconnection Logic

- Exponential backoff for failed connections
- Circuit breaker pattern for failing components
- Health check recovery
- Graceful degradation

### Error Recovery

- Automatic restart on critical failures
- State preservation during restarts
- Error categorization and handling
- Rollback capabilities

## Testing

Comprehensive test suite covering:
- Unit tests for all components
- Integration tests for cross-component interaction
- Performance benchmarks
- Security validation
- Protocol compliance testing

```bash
npm test src/mcp/tests/mcp-integration.test.ts
```

## Transport Implementations

### Stdio Transport (`transports/stdio.ts`)

For command-line and process-based communication:
- Standard input/output handling
- Process lifecycle management
- Error stream handling

### HTTP Transport (`transports/http.ts`)

For web-based communication:
- RESTful API endpoints
- WebSocket upgrade support
- CORS handling
- TLS/SSL support

### WebSocket Transport (Planned)

For real-time bidirectional communication:
- Connection management
- Message framing
- Reconnection handling

## Extension Points

### Custom Tools

Implement custom tools by providing:
- Tool definition with schema
- Handler function
- Capability information
- Permission requirements

### Custom Transports

Implement the `ITransport` interface:
- Request/response handling
- Connection management
- Health status reporting

### Custom Authentication

Extend the `AuthManager` class:
- Custom authentication methods
- Integration with external providers
- Custom permission models

## Best Practices

### Performance

- Use batch operations for multiple requests
- Implement proper caching strategies
- Monitor memory usage and clean up resources
- Use connection pooling for HTTP transport

### Security

- Always use HTTPS in production
- Implement proper token rotation
- Use strong password hashing (bcrypt)
- Monitor for suspicious activity

### Reliability

- Implement health checks for all components
- Use graceful shutdown procedures
- Monitor system resources
- Implement proper logging and alerting

### Scalability

- Use load balancing for high traffic
- Implement horizontal scaling strategies
- Monitor performance metrics
- Use asynchronous operations where possible

## Troubleshooting

### Common Issues

1. **Connection Failures**: Check network connectivity and firewall settings
2. **Authentication Errors**: Verify tokens and credentials
3. **Performance Issues**: Monitor metrics and check for bottlenecks
4. **Memory Leaks**: Review resource cleanup and garbage collection

### Debug Mode

Enable debug logging:
```typescript
const logger = createLogger({ level: 'debug' });
```

### Health Checks

Monitor component health:
```typescript
const health = await server.getHealthStatus();
console.log('Server healthy:', health.healthy);
console.log('Metrics:', health.metrics);
```

## Future Enhancements

- WebSocket transport implementation
- Advanced load balancing algorithms
- Machine learning-based optimization
- Enhanced security features (2FA, SSO)
- Distributed deployment support
- Real-time collaboration features

## API Reference

See the individual component files for detailed API documentation:
- [Server API](./server.ts)
- [Lifecycle Manager API](./lifecycle-manager.ts)
- [Tool Registry API](./tools.ts)
- [Protocol Manager API](./protocol-manager.ts)
- [Auth Manager API](./auth.ts)
- [Performance Monitor API](./performance-monitor.ts)
- [Orchestration Integration API](./orchestration-integration.ts)