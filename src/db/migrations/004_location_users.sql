-- Migration: Create location_users table for daily email recipients
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS location_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  user_name text,
  role text DEFAULT 'manager' CHECK (role IN ('manager', 'director', 'admin')),
  receives_daily_email boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Unique constraint: one email per location
ALTER TABLE location_users ADD CONSTRAINT location_users_location_email_unique
  UNIQUE (location_id, user_email);

-- Enable RLS
ALTER TABLE location_users ENABLE ROW LEVEL SECURITY;

-- Anon can read (needed for settings page fetches)
CREATE POLICY "anon_read_location_users" ON location_users
  FOR SELECT TO anon USING (true);

-- Service role can do everything (needed for cron + admin API)
CREATE POLICY "service_role_all_location_users" ON location_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can read
CREATE POLICY "authenticated_read_location_users" ON location_users
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can insert/update/delete (for settings page)
CREATE POLICY "authenticated_write_location_users" ON location_users
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed: Add initial admin user
INSERT INTO location_users (location_id, user_email, user_name, role, receives_daily_email)
VALUES ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'rr@methodco.com', 'Ross Richardson', 'admin', true)
ON CONFLICT (location_id, user_email) DO NOTHING;
