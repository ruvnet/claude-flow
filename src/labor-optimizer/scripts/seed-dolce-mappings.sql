-- Dolce Job Mapping table + initial seed for Lowland
-- Run via Supabase SQL editor or Management API

-- Create table
CREATE TABLE IF NOT EXISTS dolce_job_mapping (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  dolce_role_name text NOT NULL,
  dashboard_position text NOT NULL CHECK (dashboard_position IN (
    'Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training',
    'Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers', 'EXCLUDE'
  )),
  UNIQUE(location_id, dolce_role_name)
);

-- RLS policies
ALTER TABLE dolce_job_mapping ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dolce_job_mapping' AND policyname = 'Anon can read dolce_job_mapping'
  ) THEN
    CREATE POLICY "Anon can read dolce_job_mapping" ON dolce_job_mapping FOR SELECT TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dolce_job_mapping' AND policyname = 'Anon can manage dolce_job_mapping'
  ) THEN
    CREATE POLICY "Anon can manage dolce_job_mapping" ON dolce_job_mapping FOR ALL TO anon USING (true);
  END IF;
END $$;

-- Seed initial Lowland mappings
-- Location ID: f36fdb18-a97b-48af-8456-7374dea4b0f9
INSERT INTO dolce_job_mapping (location_id, dolce_role_name, dashboard_position) VALUES
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Lowland server', 'Server'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Lowland bartender', 'Bartender'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Lowland sidework', 'Support'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Lowland support', 'Support'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Lowland host', 'Host'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Maitre''D', 'Host'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Foh training', 'Training'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Lead bar admin', 'Bartender'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Polisher', 'Support'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Cook', 'Line Cooks'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Prep', 'Prep Cooks'),
  ('f36fdb18-a97b-48af-8456-7374dea4b0f9', 'Dishwasher', 'Dishwashers')
ON CONFLICT (location_id, dolce_role_name) DO NOTHING;
