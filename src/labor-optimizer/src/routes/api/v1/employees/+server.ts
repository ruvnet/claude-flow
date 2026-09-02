import { json, type RequestHandler } from '@sveltejs/kit';
import { getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const position = url.searchParams.get('position');

  if (!locationId) {
    return json({ error: 'locationId required' }, { status: 400 });
  }

  let query = sb
    .from('employees')
    .select('*')
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('name');

  if (position) {
    query = query.eq('position', position);
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, { status: 500 });

  // Fetch current week hours for each employee
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const weekStart = monday.toISOString().split('T')[0];

  const employeeIds = (data || []).map((e: any) => e.id);
  let hoursMap: Record<string, any> = {};

  if (employeeIds.length > 0) {
    const { data: hours } = await sb
      .from('employee_hours_log')
      .select('employee_id, scheduled_hours, actual_hours, overtime_hours, total_cost')
      .in('employee_id', employeeIds)
      .eq('week_start_date', weekStart);

    for (const h of hours || []) {
      hoursMap[h.employee_id] = h;
    }
  }

  const employees = (data || []).map((e: any) => ({
    ...e,
    week_hours: hoursMap[e.id] || null,
  }));

  return json({ employees });
};

export const POST: RequestHandler = async ({ request }) => {
  const sb = getSupabaseService();
  const body = await request.json();

  const { name, location_id, position } = body;
  if (!name || !location_id || !position) {
    return json({ error: 'name, location_id, and position are required' }, { status: 400 });
  }

  const record = {
    location_id: body.location_id,
    name: body.name,
    email: body.email || null,
    phone: body.phone || null,
    position: body.position,
    secondary_positions: body.secondary_positions || [],
    hourly_rate: body.hourly_rate || null,
    employment_type: body.employment_type || 'full_time',
    max_hours_per_week: body.max_hours_per_week ?? 40,
    overtime_threshold: body.overtime_threshold ?? 40,
    hire_date: body.hire_date || null,
    is_active: true,
    availability: body.availability || {},
    toast_employee_id: body.toast_employee_id || null,
    dolce_employee_id: body.dolce_employee_id || null,
  };

  const { data, error } = await sb
    .from('employees')
    .insert(record)
    .select()
    .single();

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ employee: data }, { status: 201 });
};

export const PUT: RequestHandler = async ({ request }) => {
  const sb = getSupabaseService();
  const body = await request.json();

  if (!body.id) {
    return json({ error: 'id is required' }, { status: 400 });
  }

  const { id, ...updates } = body;
  // Remove fields that shouldn't be updated directly
  delete updates.created_at;
  delete updates.updated_at;
  delete updates.week_hours;

  const { data, error } = await sb
    .from('employees')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ employee: data });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const id = url.searchParams.get('id');

  if (!id) {
    return json({ error: 'id query param required' }, { status: 400 });
  }

  // Soft delete
  const { error } = await sb
    .from('employees')
    .update({ is_active: false })
    .eq('id', id);

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true });
};
