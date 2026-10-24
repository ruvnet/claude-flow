/**
 * Sample TypeScript Code for Testing
 * Used by the deep regression test suite
 */

// Sample function for testing
export function calculateSum(numbers: number[]): number {
  return numbers.reduce((acc, num) => acc + num, 0);
}

// Sample async function
export async function fetchData(url: string): Promise<string> {
  // Simulated fetch
  return `Data from ${url}`;
}

// Sample class
export class UserService {
  private users: Map<string, User> = new Map();

  async createUser(name: string, email: string): Promise<User> {
    const user: User = {
      id: `user_${Date.now()}`,
      name,
      email,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}

// Sample interface
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

// Sample authentication module (for security testing)
export class AuthService {
  private sessions: Map<string, Session> = new Map();

  async login(username: string, password: string): Promise<string | null> {
    // Validate credentials (simplified)
    if (username && password && password.length >= 8) {
      const token = `token_${Date.now()}_${Math.random().toString(36)}`;
      this.sessions.set(token, {
        userId: username,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      });
      return token;
    }
    return null;
  }

  async validateToken(token: string): Promise<boolean> {
    const session = this.sessions.get(token);
    if (!session) return false;
    return session.expiresAt > new Date();
  }

  async logout(token: string): Promise<boolean> {
    return this.sessions.delete(token);
  }
}

interface Session {
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

// Sample memory module (for memory testing)
export class MemoryStore<T> {
  private store: Map<string, { value: T; expiry?: number }> = new Map();

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiry: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiry && entry.expiry < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// Sample vector operations (for plugin testing)
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// Sample pattern for learning tests
export const samplePatterns = [
  {
    strategy: 'Use dependency injection for testability',
    domain: 'architecture',
    quality: 0.9,
  },
  {
    strategy: 'Validate inputs at boundaries',
    domain: 'security',
    quality: 0.95,
  },
  {
    strategy: 'Use TDD for critical paths',
    domain: 'testing',
    quality: 0.85,
  },
  {
    strategy: 'Cache expensive computations',
    domain: 'performance',
    quality: 0.88,
  },
  {
    strategy: 'Use HNSW for vector search',
    domain: 'memory',
    quality: 0.92,
  },
];
