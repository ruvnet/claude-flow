// Test data generators

export function generateCoordinationTasks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    priority: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
    requiredResources: [`resource-${i % 3}`],
    estimatedDuration: Math.random() * 1000
  }));
}

export function generateMemoryEntries(count: number) {
  const namespaces = ['test', 'production', 'staging', 'development'];
  const tags = ['important', 'urgent', 'archive', 'temporary', 'cached'];
  
  return Array.from({ length: count }, (_, i) => ({
    namespace: namespaces[i % namespaces.length],
    key: `entry-${i}`,
    value: {
      id: i,
      data: `Test data ${i}`,
      metadata: {
        created: new Date().toISOString(),
        source: 'generator',
        index: i
      }
    },
    tags: tags.filter(() => Math.random() > 0.5)
  }));
}

export function generateErrorScenarios() {
  return [
    {
      name: 'network-timeout',
      error: new Error('Network timeout'),
      recoverable: true
    },
    {
      name: 'invalid-input',
      error: new TypeError('Invalid input type'),
      recoverable: false
    },
    {
      name: 'resource-exhausted',
      error: new Error('Resource exhausted'),
      recoverable: true
    },
    {
      name: 'permission-denied',
      error: new Error('Permission denied'),
      recoverable: false
    }
  ];
}

export function generateEdgeCaseData() {
  return {
    strings: {
      empty: '',
      veryLong: 'x'.repeat(10000),
      unicode: '🚀🎭🌍',
      specialChars: '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\',
      whitespace: '   \t\n\r   '
    },
    numbers: {
      zero: 0,
      negative: -1,
      infinity: Infinity,
      negativeInfinity: -Infinity,
      nan: NaN,
      maxSafeInt: Number.MAX_SAFE_INTEGER,
      minSafeInt: Number.MIN_SAFE_INTEGER
    },
    objects: {
      null: null,
      undefined: undefined,
      empty: {},
      nested: { a: { b: { c: { d: 'deep' } } } },
      circular: (() => {
        const obj: any = { a: 1 };
        obj.self = obj;
        return obj;
      })()
    },
    arrays: {
      empty: [],
      sparse: [1, , , 4],
      mixed: [1, 'two', { three: 3 }, [4]],
      large: Array(1000).fill(0)
    }
  };
}