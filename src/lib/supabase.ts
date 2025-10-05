import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getSupabase(): SupabaseClient {
  const SUPABASE_URL = process.env.SUPABASE_PROJECT_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_API_ANON_AKEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) {
    throw new Error('Missing SUPABASE_PROJECT_URL env variable');
  }
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      'Missing Supabase key. Provide SUPABASE_SERVICE_ROLE_KEY (recommended for server) or SUPABASE_API_ANON_AKEY'
    );
  }
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'starticle-scraper/1.0' } },
  });
}
