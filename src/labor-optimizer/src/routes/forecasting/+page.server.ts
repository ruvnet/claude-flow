import type { PageServerLoad } from './$types';
import { getCollections } from '$lib/server/database';

export const load: PageServerLoad = async ({ url }) => {
  const db = await getCollections();
  const locationId = url.searchParams.get('locationId') || '';

  const locations = await db.locations.find({ isActive: true } as any);

  // Load recent forecasts
  const forecasts = await db.forecasts.find(
    locationId ? { locationId } as any : {} as any
  );

  // Sort by date descending, take most recent 14
  const recentForecasts = forecasts
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);

  return {
    locations,
    recentForecasts,
    locationId,
  };
};
