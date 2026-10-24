import type { PageServerLoad } from './$types';
import { getCollections } from '$lib/server/database';
import { getWeekStart } from '$lib/utils/date';

export const load: PageServerLoad = async ({ url }) => {
  const db = await getCollections();

  const weekParam = url.searchParams.get('week');
  const locationId = url.searchParams.get('locationId') || '';
  const weekStartDate = weekParam || getWeekStart(new Date());

  // Load employees
  const employees = await db.employees.find({ isActive: true } as any);

  // Load or create schedule for this week
  let schedule = await db.schedules.findOne({
    weekStartDate,
    ...(locationId ? { locationId } : {}),
  } as any);

  // Load templates
  const templates = await db.shiftTemplates.find(
    locationId ? { locationId } as any : {} as any
  );

  // Load locations
  const locations = await db.locations.find({ isActive: true } as any);

  return {
    employees: employees || [],
    schedule: schedule || null,
    templates: templates || [],
    locations: locations || [],
    weekStartDate,
    locationId,
  };
};
