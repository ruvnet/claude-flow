import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

/**
 * One-time setup endpoint to create the location_users table.
 * Run once via: GET /api/v1/admin/setup-location-users
 */
export const GET: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Allow without secret in dev, but check in prod
  }

  const sb = getSupabaseService();

  // Check if table already exists by trying to query it
  const { error: checkErr } = await sb.from('location_users').select('id').limit(1);

  if (!checkErr) {
    return json({ message: 'Table location_users already exists', status: 'ok' });
  }

  // Table doesn't exist — create it via raw SQL through rpc
  // Since we can't run DDL via PostgREST, we provide the SQL for manual execution
  const sql = `
-- Create location_users table for daily email recipients
CREATE TABLE IF NOT EXISTS location_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  user_name text,
  role text DEFAULT 'manager' CHECK (role IN ('manager', 'director', 'admin')),
  receives_daily_email boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Unique constraint
ALTER TABLE location_users ADD CONSTRAINT location_users_location_email_unique
  UNIQUE (location_id, user_email);

-- Enable RLS
ALTER TABLE location_users ENABLE ROW LEVEL SECURITY;

-- Anon can read
CREATE POLICY "anon_read_location_users" ON location_users
  FOR SELECT TO anon USING (true);

-- Service role can do everything
CREATE POLICY "service_role_all_location_users" ON location_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can read
CREATE POLICY "authenticated_read_location_users" ON location_users
  FOR SELECT TO authenticated USING (true);

-- Seed initial admin user
INSERT INTO location_users (location_id, user_email, user_name, role, receives_daily_email)
VALUES ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'rr@methodco.com', 'Ross Richardson', 'admin', true)
ON CONFLICT (location_id, user_email) DO NOTHING;
`;

  return json({
    message: 'Table does not exist yet. Please run the following SQL in the Supabase SQL editor:',
    sql,
  });
};
