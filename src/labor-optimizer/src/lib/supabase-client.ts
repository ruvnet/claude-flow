import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mmwislzsgnjxjxssynwm.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1td2lzbHpzZ25qeGp4c3N5bndtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODk1MDIsImV4cCI6MjA5MDA2NTUwMn0.18jH33IqyVE_4mLVKMGa0D-7CIuUE3mWAX6CmP796PE';

let _client: SupabaseClient | null = null;

/** Browser-side Supabase client (anon key). */
export function getClientSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}
