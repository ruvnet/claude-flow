import { json, type RequestHandler } from '@sveltejs/kit';
import { checkBudgetAlerts } from '$lib/server/domain/labor-cost/labor-cost.service';

export const GET: RequestHandler = async ({ url }) => {
  const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
  const alerts = await checkBudgetAlerts(date);
  return json({ alerts });
};
