import { execute, query, queryOne } from '../database';

export interface ConfigEntry {
  key: string;
  value: any; // Stored as JSON
  category: string;
  updatedAt: Date;
}

export class ConfigModel {
  private static readonly TABLE_NAME = 'config';

  static async set(key: string, value: any, category: string): Promise<boolean> {
    const jsonValue = JSON.stringify(value);
    
    // Use UPSERT pattern
    const result = await execute(
      `INSERT INTO ${this.TABLE_NAME} (key, value, category)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         category = excluded.category,
         updated_at = CURRENT_TIMESTAMP`,
      [key, jsonValue, category]
    );

    return result.changes > 0;
  }

  static async get(key: string): Promise<any | undefined> {
    const result = await queryOne<any>(
      `SELECT value FROM ${this.TABLE_NAME} WHERE key = ?`,
      [key]
    );

    if (!result) return undefined;
    
    try {
      return JSON.parse(result.value);
    } catch {
      return result.value; // Return as string if not valid JSON
    }
  }

  static async getByCategory(category: string): Promise<ConfigEntry[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE category = ?
       ORDER BY key`,
      [category]
    );

    return results.map(this.mapToConfigEntry);
  }

  static async getAll(): Promise<ConfigEntry[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} ORDER BY category, key`
    );

    return results.map(this.mapToConfigEntry);
  }

  static async getAllAsObject(): Promise<Record<string, any>> {
    const entries = await this.getAll();
    const config: Record<string, any> = {};

    entries.forEach(entry => {
      // Create nested object structure based on category
      if (!config[entry.category]) {
        config[entry.category] = {};
      }
      config[entry.category][entry.key] = entry.value;
    });

    return config;
  }

  static async exists(key: string): Promise<boolean> {
    const result = await queryOne<any>(
      `SELECT 1 FROM ${this.TABLE_NAME} WHERE key = ? LIMIT 1`,
      [key]
    );

    return !!result;
  }

  static async delete(key: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE key = ?`,
      [key]
    );

    return result.changes > 0;
  }

  static async deleteByCategory(category: string): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE category = ?`,
      [category]
    );

    return result.changes;
  }

  static async bulkSet(configs: Array<{ key: string; value: any; category: string }>): Promise<number> {
    let updated = 0;
    
    for (const config of configs) {
      const success = await this.set(config.key, config.value, config.category);
      if (success) updated++;
    }

    return updated;
  }

  static async getCategories(): Promise<string[]> {
    const results = await query<any>(
      `SELECT DISTINCT category FROM ${this.TABLE_NAME} ORDER BY category`
    );

    return results.map(r => r.category);
  }

  static async searchByKey(pattern: string): Promise<ConfigEntry[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE key LIKE ?
       ORDER BY category, key`,
      [`%${pattern}%`]
    );

    return results.map(this.mapToConfigEntry);
  }

  static async getModifiedAfter(date: Date): Promise<ConfigEntry[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE updated_at > ?
       ORDER BY updated_at DESC`,
      [date.toISOString()]
    );

    return results.map(this.mapToConfigEntry);
  }

  static async exportConfig(): Promise<Record<string, Record<string, any>>> {
    const config = await this.getAllAsObject();
    return config;
  }

  static async importConfig(config: Record<string, Record<string, any>>): Promise<number> {
    const configs: Array<{ key: string; value: any; category: string }> = [];

    for (const [category, values] of Object.entries(config)) {
      for (const [key, value] of Object.entries(values)) {
        configs.push({ key, value, category });
      }
    }

    return this.bulkSet(configs);
  }

  static async getStatistics(): Promise<{
    totalEntries: number;
    entriesByCategory: Record<string, number>;
    lastUpdated: Date | null;
  }> {
    const totalResult = await queryOne<any>(
      `SELECT COUNT(*) as count FROM ${this.TABLE_NAME}`
    );

    const categoryResults = await query<any>(
      `SELECT category, COUNT(*) as count 
       FROM ${this.TABLE_NAME} 
       GROUP BY category`
    );

    const lastUpdatedResult = await queryOne<any>(
      `SELECT MAX(updated_at) as last_updated FROM ${this.TABLE_NAME}`
    );

    const entriesByCategory: Record<string, number> = {};
    categoryResults.forEach(row => {
      entriesByCategory[row.category] = row.count;
    });

    return {
      totalEntries: totalResult?.count || 0,
      entriesByCategory,
      lastUpdated: lastUpdatedResult?.last_updated 
        ? new Date(lastUpdatedResult.last_updated) 
        : null
    };
  }

  private static mapToConfigEntry(row: any): ConfigEntry {
    let value: any;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }

    return {
      key: row.key,
      value,
      category: row.category,
      updatedAt: new Date(row.updated_at)
    };
  }
}