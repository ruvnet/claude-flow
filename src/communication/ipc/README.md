# Claude-Flow IPC Layer

A cross-platform Inter-Process Communication (IPC) layer for Claude-Flow, enabling secure and reliable communication between processes.

## Features

- **Cross-Platform Support**
  - Unix domain sockets (Linux/macOS)
  - Named pipes (Windows)
  - HTTP transport (universal fallback)
  
- **Security**
  - Optional authentication with tokens
  - Message encryption (AES-256-GCM)
  - Rate limiting
  - Message size limits
  
- **Reliability**
  - Automatic reconnection
  - Heartbeat monitoring
  - Error handling and recovery
  - Message queuing

- **Scalability**
  - Multi-connection support
  - Broadcast capabilities
  - Process registry integration

## Quick Start

### Basic Server

```typescript
import { IPCFactory } from './index.js';

// Create and start server
const server = IPCFactory.createServer();

// Register command handler
server.registerHandler('greet', async (payload) => {
  return { message: `Hello, ${payload.name}!` };
});

await server.start();
```

### Basic Client

```typescript
import { IPCFactory } from './index.js';

// Create and connect client
const client = IPCFactory.createClient();
await client.connect();

// Send request and get response
const response = await client.request('greet', { name: 'World' });
console.log(response); // { message: 'Hello, World!' }

await client.disconnect();
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   IPC Client    │────▶│   IPC Server    │
├─────────────────┤     ├─────────────────┤
│   Transport     │     │   Transport     │
│  (Unix/Pipe)    │     │  (Unix/Pipe)    │
└─────────────────┘     └─────────────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────────────┐
              │   Protocol   │
              │  (Security)  │
              └──────────────┘
```

## Transport Selection

The IPC layer automatically selects the appropriate transport based on the platform:

- **Linux/macOS**: Unix domain sockets (`/tmp/claude-flow/*.sock`)
- **Windows**: Named pipes (`\\.\pipe\claude-flow-*`)
- **Fallback**: HTTP transport (configurable port)

## Security Configuration

Enable security features for production environments:

```typescript
const server = IPCFactory.createServer({
  security: {
    enableAuthentication: true,
    enableEncryption: true,
    authToken: 'your-secure-token',
    allowedProcesses: ['claude-flow', 'authorized-app'],
    maxMessageSize: 10 * 1024 * 1024, // 10MB
    rateLimitPerSecond: 100
  }
});
```

## Common Patterns

### Orchestrator Pattern

```typescript
import { createOrchestratorServer, createOrchestratorClient } from './index.js';

// Orchestrator server
const orchestrator = createOrchestratorServer();
await orchestrator.start();

// Client connecting to orchestrator
const client = createOrchestratorClient();
await client.connect();
```

### Agent Communication

```typescript
import { createAgentServer, createAgentClient } from './index.js';

// Agent server
const agentServer = createAgentServer('agent-123');
await agentServer.start();

// Connect to agent
const agentClient = createAgentClient('agent-123');
await agentClient.connect();
```

### Process Registry

```typescript
// Register process
await client.send({
  type: MessageType.PROCESS_REGISTER,
  payload: {
    processName: 'my-worker',
    processType: 'agent',
    capabilities: ['task-execution']
  }
});

// Send heartbeat
await client.send({
  type: MessageType.PROCESS_HEARTBEAT,
  payload: { processId: 'my-worker-id' }
});
```

## API Reference

### IPCFactory

- `createServer(config?)`: Create an IPC server
- `createClient(config?)`: Create an IPC client

### IPCServer

- `start()`: Start listening for connections
- `stop()`: Stop the server
- `registerHandler(command, handler)`: Register a command handler
- `broadcast(message, excludeConnection?)`: Broadcast to all connections

### IPCClient

- `connect()`: Connect to server
- `disconnect()`: Disconnect from server
- `send(message)`: Send a message
- `request(command, payload?, timeout?)`: Send request and wait for response

### Events

Server events:
- `connection`: New client connected
- `error`: Server error
- `listening`: Server started listening

Client events:
- `connected`: Connected to server
- `disconnected`: Disconnected from server
- `message`: Received message
- `error`: Client error

## Examples

See the `examples/` directory for complete examples:

- Basic client/server communication
- Multi-agent coordination
- Secure communication
- Process management
- Error handling and reconnection

## Troubleshooting

### Connection Failed

1. Check if server is running
2. Verify IPC path permissions
3. Ensure firewall allows connections (HTTP transport)

### Authentication Failed

1. Verify auth tokens match on client and server
2. Check system time synchronization
3. Ensure token hasn't expired

### Performance Issues

1. Enable connection pooling for high throughput
2. Adjust rate limits based on workload
3. Use broadcast for one-to-many communication

## Integration with Claude-Flow Commands

The IPC layer integrates seamlessly with Claude-Flow commands:

```typescript
import { CommandIPCIntegration } from './integration/command-integration.js';

class MyCommand extends CommandIPCIntegration {
  protected getCommandName(): string {
    return 'my-command';
  }
  
  protected async executeCommand(args: any, options: any): Promise<any> {
    // Command logic here
    return { result: 'success' };
  }
}

const command = new MyCommand();
await command.startCommandServer('my-command');
await command.connectToOrchestrator();
```