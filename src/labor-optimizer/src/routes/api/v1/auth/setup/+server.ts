import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

/**
 * One-time admin user setup endpoint.
 * POST /api/v1/auth/setup
 * Body: { email: string, password: string }
 *
 * Only works when zero auth users exist in the project.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return json({ error: 'email and password are required' }, { status: 400 });
  }
  if (password.length < 6) {
    return json({ error: 'password must be at least 6 characters' }, { status: 400 });
  }

  const sb = getSupabaseService();

  // Check if any users already exist
  const { data: existingUsers, error: listError } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });

  if (listError) {
    return json({ error: `Failed to check existing users: ${listError.message}` }, { status: 500 });
  }

  if (existingUsers && existingUsers.users && existingUsers.users.length > 0) {
    return json({ error: 'Setup already completed. Users already exist.' }, { status: 409 });
  }

  // Create the admin user
  const { data: newUser, error: createError } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    return json({ error: `Failed to create user: ${createError.message}` }, { status: 500 });
  }

  return json({
    success: true,
    message: 'Admin user created successfully.',
    userId: newUser.user.id,
    email: newUser.user.email,
  });
};
