import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';

export const GET: RequestHandler = async ({ url }) => {
  const db = await getCollections();
  const locationId = url.searchParams.get('locationId');

  let filter: Record<string, unknown> = {};
  if (locationId) {
    // Get violations for this location's schedules
  }

  const rules = await db.complianceRules.find({} as any);
  const violations = await db.complianceViolations.find(filter as any);

  return json({
    rules,
    violations,
    summary: {
      totalRules: rules.length,
      activeViolations: violations.filter(v => !v.resolvedAt).length,
      resolvedViolations: violations.filter(v => v.resolvedAt).length,
    },
  });
};
