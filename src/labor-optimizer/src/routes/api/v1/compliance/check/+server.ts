import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';
import { checkCompliance, seedComplianceRules } from '$lib/server/domain/compliance/rules-engine';

export const POST: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();
  const { scheduleId } = body;

  if (!scheduleId) {
    return json({ error: 'scheduleId required' }, { status: 400 });
  }

  // Seed rules if needed
  await seedComplianceRules();

  const schedule = await db.schedules.findOne({ _id: scheduleId } as any);
  if (!schedule) {
    return json({ error: 'Schedule not found' }, { status: 404 });
  }

  const employees = await db.employees.find({ isActive: true } as any);
  const rules = await db.complianceRules.find({} as any);

  const result = checkCompliance(schedule, schedule.shifts || [], employees, rules);

  // Store violations
  for (const violation of result.violations) {
    await db.complianceViolations.insertOne(violation as any);
  }

  return json({
    status: 'compliance_check_complete',
    scheduleId,
    passed: result.passed,
    rulesChecked: result.rulesChecked,
    violations: result.violations,
    warnings: result.warnings,
    summary: result.summary,
  });
};
