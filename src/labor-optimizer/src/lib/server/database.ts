/**
 * Labor Optimizer Database — self-contained RVF document store.
 */

import type { Location } from '$lib/types/Location';
import type { Employee } from '$lib/types/Employee';
import type { Schedule, Shift, ShiftTemplate } from '$lib/types/Schedule';
import type { DemandForecast } from '$lib/types/DemandForecast';
import type { LaborCostSnapshot } from '$lib/types/LaborCost';
import type { ComplianceRule, ComplianceViolation } from '$lib/types/Compliance';
import type { AppUser } from '$lib/types/Auth';

import { building } from '$app/environment';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

// Simple in-memory document store for development
// In production, replace with MongoDB or the RVF store from ruvocal

interface Document {
  _id: string;
  [key: string]: unknown;
}

class SimpleCollection<T extends Document> {
  private store = new Map<string, T>();
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  async findOne(filter: Partial<T>): Promise<T | null> {
    for (const doc of this.store.values()) {
      if (this.matches(doc, filter)) return doc;
    }
    return null;
  }

  async find(filter: Partial<T> = {}): Promise<T[]> {
    const results: T[] = [];
    for (const doc of this.store.values()) {
      if (this.matches(doc, filter)) results.push(doc);
    }
    return results;
  }

  async insertOne(doc: T): Promise<{ insertedId: string }> {
    if (!doc._id) {
      doc._id = crypto.randomUUID();
    }
    this.store.set(doc._id, doc);
    return { insertedId: doc._id };
  }

  async updateOne(filter: Partial<T>, update: { $set: Partial<T> }): Promise<{ modifiedCount: number }> {
    for (const [id, doc] of this.store) {
      if (this.matches(doc, filter)) {
        const updated = { ...doc, ...update.$set, updatedAt: new Date().toISOString() };
        this.store.set(id, updated as T);
        return { modifiedCount: 1 };
      }
    }
    return { modifiedCount: 0 };
  }

  async deleteOne(filter: Partial<T>): Promise<{ deletedCount: number }> {
    for (const [id, doc] of this.store) {
      if (this.matches(doc, filter)) {
        this.store.delete(id);
        return { deletedCount: 1 };
      }
    }
    return { deletedCount: 0 };
  }

  async countDocuments(filter: Partial<T> = {}): Promise<number> {
    return (await this.find(filter)).length;
  }

  private matches(doc: T, filter: Partial<T>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if ((doc as Record<string, unknown>)[key] !== value) return false;
    }
    return true;
  }
}

class Database {
  private static instance: Database;
  private initialized = false;

  private async init() {
    const dbFolder = process.env.RVF_DB_PATH ||
      join(dirname(fileURLToPath(import.meta.url)), '../../../../db');

    if (!existsSync(dbFolder)) {
      mkdirSync(dbFolder, { recursive: true });
    }

    console.log(`[LaborOptimizer] Database initialized at: ${dbFolder}`);
    this.initialized = true;
  }

  public static async getInstance(): Promise<Database> {
    if (!Database.instance) {
      Database.instance = new Database();
      await Database.instance.init();
    }
    return Database.instance;
  }

  public getCollections() {
    if (!this.initialized) {
      throw new Error('Database not initialized');
    }

    return {
      locations: new SimpleCollection<Location & Document>('locations'),
      employees: new SimpleCollection<Employee & Document>('employees'),
      schedules: new SimpleCollection<Schedule & Document>('schedules'),
      shifts: new SimpleCollection<Shift & Document>('shifts'),
      shiftTemplates: new SimpleCollection<ShiftTemplate & Document>('shiftTemplates'),
      forecasts: new SimpleCollection<DemandForecast & Document>('forecasts'),
      laborCosts: new SimpleCollection<LaborCostSnapshot & Document>('laborCosts'),
      complianceRules: new SimpleCollection<ComplianceRule & Document>('complianceRules'),
      complianceViolations: new SimpleCollection<ComplianceViolation & Document>('complianceViolations'),
      users: new SimpleCollection<AppUser & Document>('users'),
    };
  }
}

export let collections: ReturnType<typeof Database.prototype.getCollections>;

export const ready = (async () => {
  if (!building) {
    const db = await Database.getInstance();
    collections = db.getCollections();

    // Auto-seed on first startup (deferred to avoid blocking init)
    setTimeout(async () => {
      try {
        const { seedDatabase } = await import('./seed');
        await seedDatabase();
      } catch (e) {
        console.warn('[LaborOptimizer] Seed skipped:', (e as Error).message);
      }
    }, 100);
  } else {
    collections = {} as ReturnType<typeof Database.prototype.getCollections>;
  }
})();

export async function getCollections() {
  await ready;
  if (!collections) {
    throw new Error('Database not initialized');
  }
  return collections;
}
