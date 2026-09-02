/**
 * Database Seed — pre-populates HELIXO locations with Toast GUIDs.
 * Run on first startup or via /api/v1/seed endpoint.
 */
import { getCollections } from './database';
import type { Location } from '$lib/types/Location';
import { getDefaultStaffingConfig } from '$lib/utils/labor-math';
import { BUILT_IN_RULES } from './domain/compliance/rules-engine';

const HELIXO_LOCATIONS: Omit<Location, 'createdAt' | 'updatedAt'>[] = [
  {
    _id: 'loc-anthology-events',
    name: 'Anthology Events',
    type: 'restaurant_bar',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '805eee0d-3a41-42a1-bd7a-f400363e9fd9' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-bar-rotunda',
    name: 'Bar Rotunda & Le Supreme',
    type: 'restaurant_bar',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '99d1583c-6e31-43dc-89f8-8d2e19ac147b' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-hiroki',
    name: 'HIROKI',
    type: 'restaurant',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '45d266c6-7dd1-43cb-9b09-2c157f277a3c' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.30,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-kampers',
    name: "Kamper's",
    type: 'restaurant_bar',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '0541cfe4-f874-46a9-91ed-0380408a6f2a' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-little-wing',
    name: 'Little Wing Coffee & Goods',
    type: 'restaurant',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: 'a8a82047-9940-4be2-a090-d3da71b51fe4' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.32,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-lowland',
    name: 'Lowland',
    type: 'restaurant_bar',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '8a5cb8ab-308d-482f-b498-c6bc2a16c96c' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-rosemary-rose',
    name: 'Rosemary Rose',
    type: 'restaurant',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '757c51f9-ae4a-4dd2-9609-e231f21df72a' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-sakazuki',
    name: 'Sakazuki & Hiroki-San',
    type: 'restaurant_bar',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '1480f7c0-7b54-4c74-bec9-862f8e0efc0e' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-quoin',
    name: 'The Quoin Restaurant',
    type: 'restaurant_bar',
    address: 'Detroit, MI',
    timezone: 'America/Detroit',
    posIntegration: { provider: 'toast', restaurantGuid: '2d1d8888-91d2-41a4-8167-3ba7b0c10c90' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
  {
    _id: 'loc-mulherins',
    name: "Wm. Mulherin's Sons",
    type: 'restaurant_bar',
    address: 'Philadelphia, PA',
    timezone: 'America/New_York',
    posIntegration: { provider: 'toast', restaurantGuid: 'c70fe34e-3f99-4258-8e8a-428c863714ef' },
    operatingHours: defaultHours(),
    laborBudgetPct: 0.28,
    staffingConfig: getDefaultStaffingConfig(),
    isActive: true,
  },
];

function defaultHours() {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    openTime: '11:00',
    closeTime: '23:00',
    isClosed: false,
  }));
}

/** Seed the database with HELIXO locations and compliance rules */
export async function seedDatabase(): Promise<{ locationsSeeded: number; rulesSeeded: number }> {
  const db = await getCollections();

  let locationsSeeded = 0;
  let rulesSeeded = 0;

  // Seed locations
  const existingLocations = await db.locations.countDocuments();
  if (existingLocations === 0) {
    const now = new Date().toISOString();
    for (const loc of HELIXO_LOCATIONS) {
      await db.locations.insertOne({
        ...loc,
        createdAt: now,
        updatedAt: now,
      } as any);
      locationsSeeded++;
    }
    console.log(`[Seed] Created ${locationsSeeded} HELIXO locations`);
  }

  // Seed compliance rules
  const existingRules = await db.complianceRules.countDocuments();
  if (existingRules === 0) {
    for (const rule of BUILT_IN_RULES) {
      await db.complianceRules.insertOne(rule as any);
      rulesSeeded++;
    }
    console.log(`[Seed] Created ${rulesSeeded} compliance rules`);
  }

  return { locationsSeeded, rulesSeeded };
}
