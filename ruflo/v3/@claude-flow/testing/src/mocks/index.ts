/**
 * @claude-flow/testing - Mocks Index
 *
 * Central export for all mock implementations
 */

// Mock services
export {
  MockAgentDB,
  MockSwarmCoordinator,
  MockSwarmAgent,
  MockMemoryService,
  MockEventBus,
  MockSecurityService,
  createMockServices,
  resetMockServices,
  type MockServiceBundle,
} from './mock-services.js';

// Mock MCP client and server
export {
  MockMCPClient,
  MockMCPServer,
  MockMCPConnection,
  MCPClientError,
  createStandardMockMCPClient,
  createFailingMockMCPClient,
  createSlowMockMCPClient,
} from './mock-mcp-client.js';
