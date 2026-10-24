/**
 * V3 Claude-Flow Configuration Fixtures
 *
 * Test data for configuration testing
 * Following London School principle of explicit test data
 */

/**
 * Security configuration interface
 */
export interface SecurityConfig {
  validation: {
    maxInputSize: number;
    allowedChars: RegExp;
    sanitizeHtml: boolean;
  };
  paths: {
    allowedDirectories: string[];
    blockedPatterns: string[];
    maxPathLength: number;
  };
  execution: {
    shell: boolean;
    timeout: number;
    allowedCommands: string[];
    blockedCommands: string[];
  };
  hashing: {
    algorithm: 'argon2' | 'bcrypt' | 'scrypt';
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
  };
}

/**
 * Memory configuration interface
 */
export interface MemoryConfig {
  backend: 'agentdb' | 'sqlite' | 'memory' | 'hybrid';
  vectorDimensions: number;
  hnswConfig: {
    M: number;
    efConstruction: number;
    efSearch: number;
  };
  caching: {
    enabled: boolean;
    maxSize: number;
    ttl: number;
  };
  quantization: {
    enabled: boolean;
    bits: 4 | 8;
  };
}

/**
 * Swarm configuration interface
 */
export interface SwarmConfig {
  topology: 'hierarchical' | 'mesh' | 'adaptive' | 'hierarchical-mesh';
  maxAgents: number;
  coordination: {
    consensusProtocol: 'raft' | 'pbft' | 'gossip';
    heartbeatInterval: number;
    electionTimeout: number;
  };
  communication: {
    protocol: 'quic' | 'tcp' | 'websocket';
    maxMessageSize: number;
    retryAttempts: number;
  };
}

/**
 * MCP configuration interface
 */
export interface MCPConfig {
  server: {
    port: number;
    host: string;
    protocol: 'http' | 'https' | 'stdio';
  };
  connection: {
    poolSize: number;
    timeout: number;
    keepAlive: boolean;
  };
  tools: {
    enabled: string[];
    disabled: string[];
  };
}

/**
 * Performance configuration interface
 */
export interface PerformanceConfig {
  targets: {
    flashAttentionSpeedup: [number, number]; // [min, max]
    agentDBSearchImprovement: [number, number];
    memoryReduction: number;
    startupTime: number;
  };
  monitoring: {
    enabled: boolean;
    samplingRate: number;
    metricsEndpoint?: string;
  };
  optimization: {
    batchSize: number;
    parallelism: number;
    cacheStrategy: 'lru' | 'lfu' | 'arc';
  };
}

/**
 * Pre-defined security configurations for testing
 */
export const securityConfigs: Record<string, SecurityConfig> = {
  strict: {
    validation: {
      maxInputSize: 10000,
      allowedChars: /^[a-zA-Z0-9._\-\s]+$/,
      sanitizeHtml: true,
    },
    paths: {
      allowedDirectories: ['./v3/', './src/', './tests/'],
      blockedPatterns: ['../', '~/', '/etc/', '/tmp/', '/var/'],
      maxPathLength: 255,
    },
    execution: {
      shell: false,
      timeout: 30000,
      allowedCommands: ['npm', 'npx', 'node', 'git'],
      blockedCommands: ['rm', 'del', 'format', 'dd', 'chmod', 'chown'],
    },
    hashing: {
      algorithm: 'argon2',
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    },
  },

  development: {
    validation: {
      maxInputSize: 50000,
      allowedChars: /^[\x20-\x7E\n\r\t]+$/,
      sanitizeHtml: false,
    },
    paths: {
      allowedDirectories: ['./', './node_modules/'],
      blockedPatterns: ['../', '~/'],
      maxPathLength: 512,
    },
    execution: {
      shell: false, // Security: Always disable shell to prevent injection
      timeout: 60000,
      allowedCommands: ['npm', 'npx', 'node', 'git', 'yarn', 'pnpm'],
      blockedCommands: ['rm', 'rmdir', 'del', 'format', 'dd', 'chmod', 'chown', 'sudo', 'su'],
    },
    hashing: {
      algorithm: 'bcrypt',
    },
  },

  production: {
    validation: {
      maxInputSize: 5000,
      allowedChars: /^[a-zA-Z0-9._\-]+$/,
      sanitizeHtml: true,
    },
    paths: {
      allowedDirectories: ['/app/'],
      blockedPatterns: ['../', '~/', '/etc/', '/tmp/', '/var/', '/root/'],
      maxPathLength: 200,
    },
    execution: {
      shell: false,
      timeout: 15000,
      allowedCommands: ['node'],
      blockedCommands: ['rm', 'del', 'format', 'dd', 'chmod', 'chown', 'sudo'],
    },
    hashing: {
      algorithm: 'argon2',
      memoryCost: 131072,
      timeCost: 4,
      parallelism: 4,
    },
  },
};

/**
 * Pre-defined memory configurations for testing
 */
export const memoryConfigs: Record<string, MemoryConfig> = {
  agentDB: {
    backend: 'agentdb',
    vectorDimensions: 384,
    hnswConfig: {
      M: 16,
      efConstruction: 200,
      efSearch: 50,
    },
    caching: {
      enabled: true,
      maxSize: 1000,
      ttl: 3600000,
    },
    quantization: {
      enabled: true,
      bits: 8,
    },
  },

  hybrid: {
    backend: 'hybrid',
    vectorDimensions: 384,
    hnswConfig: {
      M: 32,
      efConstruction: 400,
      efSearch: 100,
    },
    caching: {
      enabled: true,
      maxSize: 5000,
      ttl: 7200000,
    },
    quantization: {
      enabled: true,
      bits: 4,
    },
  },

  inMemory: {
    backend: 'memory',
    vectorDimensions: 384,
    hnswConfig: {
      M: 8,
      efConstruction: 100,
      efSearch: 25,
    },
    caching: {
      enabled: false,
      maxSize: 0,
      ttl: 0,
    },
    quantization: {
      enabled: false,
      bits: 8,
    },
  },
};

/**
 * Pre-defined swarm configurations for testing
 */
export const swarmConfigs: Record<string, SwarmConfig> = {
  v3Default: {
    topology: 'hierarchical-mesh',
    maxAgents: 15,
    coordination: {
      consensusProtocol: 'raft',
      heartbeatInterval: 1000,
      electionTimeout: 5000,
    },
    communication: {
      protocol: 'quic',
      maxMessageSize: 1048576, // 1MB
      retryAttempts: 3,
    },
  },

  minimal: {
    topology: 'mesh',
    maxAgents: 5,
    coordination: {
      consensusProtocol: 'gossip',
      heartbeatInterval: 2000,
      electionTimeout: 10000,
    },
    communication: {
      protocol: 'tcp',
      maxMessageSize: 65536, // 64KB
      retryAttempts: 5,
    },
  },

  highPerformance: {
    topology: 'adaptive',
    maxAgents: 50,
    coordination: {
      consensusProtocol: 'pbft',
      heartbeatInterval: 500,
      electionTimeout: 3000,
    },
    communication: {
      protocol: 'quic',
      maxMessageSize: 4194304, // 4MB
      retryAttempts: 2,
    },
  },
};

/**
 * Pre-defined MCP configurations for testing
 */
export const mcpConfigs: Record<string, MCPConfig> = {
  development: {
    server: {
      port: 3000,
      host: 'localhost',
      protocol: 'http',
    },
    connection: {
      poolSize: 10,
      timeout: 30000,
      keepAlive: true,
    },
    tools: {
      enabled: ['*'],
      disabled: [],
    },
  },

  production: {
    server: {
      port: 443,
      host: '0.0.0.0',
      protocol: 'https',
    },
    connection: {
      poolSize: 100,
      timeout: 15000,
      keepAlive: true,
    },
    tools: {
      enabled: ['swarm_init', 'agent_spawn', 'task_orchestrate', 'memory_usage'],
      disabled: ['debug_*', 'test_*'],
    },
  },

  stdio: {
    server: {
      port: 0,
      host: '',
      protocol: 'stdio',
    },
    connection: {
      poolSize: 1,
      timeout: 60000,
      keepAlive: false,
    },
    tools: {
      enabled: ['*'],
      disabled: [],
    },
  },
};

/**
 * Pre-defined performance configurations for testing
 */
export const performanceConfigs: Record<string, PerformanceConfig> = {
  v3Targets: {
    targets: {
      flashAttentionSpeedup: [2.49, 7.47],
      agentDBSearchImprovement: [150, 12500],
      memoryReduction: 0.50,
      startupTime: 500,
    },
    monitoring: {
      enabled: true,
      samplingRate: 0.1,
      metricsEndpoint: '/metrics',
    },
    optimization: {
      batchSize: 100,
      parallelism: 4,
      cacheStrategy: 'arc',
    },
  },

  minimal: {
    targets: {
      flashAttentionSpeedup: [1.0, 2.0],
      agentDBSearchImprovement: [10, 100],
      memoryReduction: 0.25,
      startupTime: 2000,
    },
    monitoring: {
      enabled: false,
      samplingRate: 0,
    },
    optimization: {
      batchSize: 10,
      parallelism: 1,
      cacheStrategy: 'lru',
    },
  },
};

/**
 * Factory functions to create configurations with overrides
 */
export function createSecurityConfig(
  base: keyof typeof securityConfigs,
  overrides?: Partial<SecurityConfig>
): SecurityConfig {
  return mergeDeep(securityConfigs[base] as SecurityConfig & Record<string, unknown>, (overrides ?? {}) as Partial<SecurityConfig & Record<string, unknown>>);
}

export function createMemoryConfig(
  base: keyof typeof memoryConfigs,
  overrides?: Partial<MemoryConfig>
): MemoryConfig {
  return mergeDeep(memoryConfigs[base] as MemoryConfig & Record<string, unknown>, (overrides ?? {}) as Partial<MemoryConfig & Record<string, unknown>>);
}

export function createSwarmConfigFromBase(
  base: keyof typeof swarmConfigs,
  overrides?: Partial<SwarmConfig>
): SwarmConfig {
  return mergeDeep(swarmConfigs[base] as SwarmConfig & Record<string, unknown>, (overrides ?? {}) as Partial<SwarmConfig & Record<string, unknown>>);
}

export function createMCPConfig(
  base: keyof typeof mcpConfigs,
  overrides?: Partial<MCPConfig>
): MCPConfig {
  return mergeDeep(mcpConfigs[base] as MCPConfig & Record<string, unknown>, (overrides ?? {}) as Partial<MCPConfig & Record<string, unknown>>);
}

export function createPerformanceConfig(
  base: keyof typeof performanceConfigs,
  overrides?: Partial<PerformanceConfig>
): PerformanceConfig {
  return mergeDeep(performanceConfigs[base] as PerformanceConfig & Record<string, unknown>, (overrides ?? {}) as Partial<PerformanceConfig & Record<string, unknown>>);
}

/**
 * Deep merge utility
 */
function mergeDeep<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const output = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    const sourceValue = source[key as keyof T];
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      output[key] = mergeDeep(
        (target[key as keyof T] as Record<string, unknown>) ?? {},
        sourceValue as Record<string, unknown>
      );
    } else {
      output[key] = sourceValue;
    }
  }

  return output as T;
}

/**
 * Invalid configurations for error testing
 */
export const invalidConfigs = {
  security: {
    negativeMaxInputSize: createSecurityConfig('strict', {
      validation: { maxInputSize: -1, allowedChars: /.*/, sanitizeHtml: true },
    }),
    emptyAllowedCommands: createSecurityConfig('strict', {
      execution: { shell: false, timeout: 1000, allowedCommands: [], blockedCommands: [] },
    }),
  },

  memory: {
    zeroDimensions: createMemoryConfig('agentDB', { vectorDimensions: 0 }),
    invalidQuantization: createMemoryConfig('agentDB', { quantization: { enabled: true, bits: 16 as 4 | 8 } }),
  },

  swarm: {
    zeroAgents: createSwarmConfigFromBase('v3Default', { maxAgents: 0 }),
    negativeHeartbeat: createSwarmConfigFromBase('v3Default', {
      coordination: { consensusProtocol: 'raft', heartbeatInterval: -100, electionTimeout: 5000 },
    }),
  },
};
