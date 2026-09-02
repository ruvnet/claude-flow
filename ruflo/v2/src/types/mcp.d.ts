// Type definitions for Model Context Protocol SDK
declare module '@modelcontextprotocol/sdk/types.js' {
  export interface Tool {
    name: string;
    description: string;
    inputSchema: {
      type: string;
      properties?: Record<string, any>;
      required?: string[];
    };
  }

  export interface CallToolRequest {
    method: string;
    params: {
      name: string;
      arguments?: Record<string, any>;
    };
  }

  export interface CallToolResult {
    content: Array<{
      type: string;
      text?: string;
    }>;
    isError?: boolean;
  }

  export interface ListToolsResult {
    tools: Tool[];
  }
}

declare module '@modelcontextprotocol/sdk/server/index.js' {
  import {
    Tool,
    CallToolRequest,
    CallToolResult,
    ListToolsResult,
  } from '@modelcontextprotocol/sdk/types.js';

  export class Server {
    constructor();
    setRequestHandler<T>(method: string, handler: (request: T) => Promise<any>): void;
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
  }
}

declare module '@modelcontextprotocol/sdk/client/index.js' {
  export class Client {
    constructor(config: { name: string; version: string });
    connect(transport: any): Promise<void>;
    request(method: string, params?: any): Promise<any>;
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export class StdioClientTransport {
    constructor(config: { command: string; args?: string[]; env?: Record<string, string> });
  }
}
