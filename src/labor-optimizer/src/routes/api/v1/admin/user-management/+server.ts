import { json, type RequestHandler } from '@sveltejs/kit';
import { getSupabase, getSupabaseService } from '$lib/server/supabase';
import { generateWelcomeGuidePdf } from '$lib/server/reports/welcome-guide-pdf';

// ---------------------------------------------------------------------------
// GET -- return all groups (with tab_permissions) and members (with auth status)
// ---------------------------------------------------------------------------
export const GET: RequestHandler = async () => {
  const sb = getSupabase();
  const sbService = getSupabaseService();

  const [grpResult, memResult, authResult] = await Promise.all([
    sb.from('user_groups').select('*').order('created_at'),
    sb.from('user_group_members').select('*').order('created_at'),
    sbService.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (grpResult.error) return json({ error: grpResult.error.message }, { status: 500 });
  if (memResult.error) return json({ error: memResult.error.message }, { status: 500 });

  const authUsers = authResult.data?.users || [];
  const authByEmail = new Map<string, { email_confirmed_at: string | null; banned_until: string | null; last_sign_in_at: string | null }>();
  for (const u of authUsers) {
    if (u.email) {
      authByEmail.set(u.email, {
        email_confirmed_at: u.email_confirmed_at ?? null,
        banned_until: u.banned_until ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
      });
    }
  }

  const enrichedMembers = (memResult.data || []).map((m) => ({
    ...m,
    auth_status: authByEmail.get(m.user_email) || null,
  }));

  const groupsWithMembers = (grpResult.data || []).map((g) => ({
    ...g,
    members: enrichedMembers.filter((m) => m.group_id === g.id),
  }));

  // Build set of emails that belong to at least one group
  const assignedEmails = new Set((memResult.data || []).map((m) => m.user_email as string));

  // Users registered in auth but not in any group
  const unassignedUsers = authUsers
    .filter((u) => u.email && !assignedEmails.has(u.email))
    .map((u) => ({
      id: u.id,
      email: u.email!,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));

  return json({ groups: groupsWithMembers, unassignedUsers });
};

// ---------------------------------------------------------------------------
// POST -- actions: create_group, update_group, delete_group,
//                  add_member, remove_member, create_user, reset_password
// ---------------------------------------------------------------------------
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { action } = body;
  const sb = getSupabase();

  // ---- Create group ----
  if (action === 'create_group') {
    const { name, description, permissions, tab_permissions } = body;
    if (!name) return json({ error: 'Name is required' }, { status: 400 });

    const { data, error } = await sb
      .from('user_groups')
      .insert({
        name,
        description: description || null,
        permissions: permissions || [],
        tab_permissions: tab_permissions || { reporting: [], planning: [], admin: [] },
      })
      .select()
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ group: data });
  }

  // ---- Update group ----
  if (action === 'update_group') {
    const { groupId, name, description, permissions, tab_permissions } = body;
    if (!groupId) return json({ error: 'groupId is required' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (permissions !== undefined) update.permissions = permissions;
    if (tab_permissions !== undefined) update.tab_permissions = tab_permissions;

    const { data, error } = await sb
      .from('user_groups')
      .update(update)
      .eq('id', groupId)
      .select()
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ group: data });
  }

  // ---- Delete group ----
  if (action === 'delete_group') {
    const { groupId } = body;
    if (!groupId) return json({ error: 'groupId is required' }, { status: 400 });
    const { error } = await sb.from('user_groups').delete().eq('id', groupId);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true });
  }

  // ---- Add member ----
  if (action === 'add_member') {
    const { groupId, email, name, locationIds } = body;
    if (!groupId || !email) return json({ error: 'groupId and email are required' }, { status: 400 });

    const sbService = getSupabaseService();
    const { data: authData } = await sbService.auth.admin.listUsers({ perPage: 1000 });
    const authUser = authData?.users?.find((u) => u.email === email);

    if (!authUser) {
      return json({ error: `No auth user found with email ${email}. Use "Create User" to create one first.` }, { status: 404 });
    }

    const { data, error } = await sb
      .from('user_group_members')
      .insert({
        user_id: authUser.id,
        user_email: email,
        user_name: name || authUser.user_metadata?.full_name || null,
        group_id: groupId,
        location_ids: locationIds || [],
      })
      .select()
      .single();

    if (error) return json({ error: error.message }, { status: 500 });

    // Sync locations to location_users so my-locations API picks them up
    if (locationIds && locationIds.length > 0) {
      const rows = locationIds.map((locId: string) => ({
        location_id: locId,
        user_email: email,
        user_id: authUser.id,
        user_name: name || authUser.user_metadata?.full_name || null,
        must_change_password: false,
      }));
      await sb.from('location_users').upsert(rows, { onConflict: 'location_id,user_email' });
    }

    return json({ member: data });
  }

  // ---- Remove member ----
  if (action === 'remove_member') {
    const { memberId } = body;
    if (!memberId) return json({ error: 'memberId is required' }, { status: 400 });
    const { error } = await sb.from('user_group_members').delete().eq('id', memberId);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true });
  }

  // ---- Move member to another group ----
  if (action === 'move_member') {
    const { memberId, fromGroupId, toGroupId } = body;
    if (!memberId || !fromGroupId || !toGroupId)
      return json({ error: 'memberId, fromGroupId, and toGroupId are required' }, { status: 400 });

    // Fetch the existing member row
    const { data: existing, error: fetchErr } = await sb
      .from('user_group_members')
      .select('*')
      .eq('id', memberId)
      .single();
    if (fetchErr || !existing) return json({ error: 'Member not found' }, { status: 404 });

    // Fetch the target group to use its name as the role
    const { data: targetGroup, error: grpErr } = await sb
      .from('user_groups')
      .select('name')
      .eq('id', toGroupId)
      .single();
    if (grpErr || !targetGroup) return json({ error: 'Target group not found' }, { status: 404 });

    // Delete old membership
    const { error: delErr } = await sb.from('user_group_members').delete().eq('id', memberId);
    if (delErr) return json({ error: delErr.message }, { status: 500 });

    // Insert new membership in target group
    const { data: newMember, error: insErr } = await sb
      .from('user_group_members')
      .insert({
        user_id: existing.user_id,
        user_email: existing.user_email,
        user_name: existing.user_name,
        group_id: toGroupId,
        role: targetGroup.name,
        location_ids: existing.location_ids || [],
      })
      .select()
      .single();
    if (insErr) return json({ error: insErr.message }, { status: 500 });

    return json({ ok: true, member: newMember });
  }

  // ---- Create user (Supabase auth + group membership) ----
  if (action === 'create_user') {
    const { email, password, name, groupId, locationIds } = body;
    if (!email || !password) return json({ error: 'email and password are required' }, { status: 400 });

    const sbService = getSupabaseService();
    const { data: authData, error: authError } = await sbService.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: name || '' },
    });
    if (authError) return json({ error: authError.message }, { status: 500 });
    const newUser = authData.user;

    if (groupId && newUser) {
      const { error: memError } = await sb
        .from('user_group_members')
        .insert({
          user_id: newUser.id, user_email: email,
          user_name: name || null, group_id: groupId,
          location_ids: locationIds || [],
        });
      if (memError) {
        return json({ error: `User created but failed to add to group: ${memError.message}` }, { status: 500 });
      }
      // Sync locations to location_users so my-locations API picks them up
      if (locationIds && locationIds.length > 0) {
        const rows = (locationIds as string[]).map((locId: string) => ({
          location_id: locId,
          user_email: email,
          user_id: newUser.id,
          user_name: name || null,
          must_change_password: true,
        }));
        await sb.from('location_users').upsert(rows, { onConflict: 'location_id,user_email' });
      }
    }

    if (newUser) {
      await sb.from('location_users').update({ must_change_password: true }).eq('user_email', email);
    }

    // Send welcome email
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (RESEND_KEY) {
      const fromAddr = process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>';
      const welcomeHtml = buildWelcomeHtml(email, password, name);
      try {
        const guidePdfBase64 = generateWelcomeGuidePdf();
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromAddr, to: [email],
            subject: 'Welcome to HELIXO | Your Account is Ready',
            html: welcomeHtml,
            attachments: [{ filename: 'HELIXO_Quick_Start_Guide.pdf', content: guidePdfBase64 }],
          }),
        });
      } catch (_) { /* non-critical */ }
    }

    return json({ user: { id: newUser?.id, email } });
  }

  // ---- Reset password ----
  if (action === 'reset_password') {
    const { email } = body;
    if (!email) return json({ error: 'email is required' }, { status: 400 });

    const sbService = getSupabaseService();
    const { data: linkData, error: linkError } = await sbService.auth.admin.generateLink({ type: 'recovery', email });
    if (linkError) return json({ error: linkError.message }, { status: 500 });

    const resetLink = linkData?.properties?.action_link;
    if (!resetLink) return json({ error: 'Failed to generate reset link' }, { status: 500 });

    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) return json({ error: 'Email service not configured' }, { status: 500 });

    const fromAddr = process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>';
    const resetHtml = buildResetHtml(resetLink);

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddr, to: [email], subject: 'HELIXO | Password Reset', html: resetHtml }),
      });
    } catch (e: any) {
      return json({ error: `Failed to send reset email: ${e.message}` }, { status: 500 });
    }

    return json({ ok: true, message: `Password reset email sent to ${email}` });
  }

  // ---- Toggle location for a member ----
  if (action === 'toggle_location') {
    const { memberId, locationId, assign } = body;
    if (!memberId || !locationId || typeof assign !== 'boolean')
      return json({ error: 'memberId, locationId, and assign (boolean) are required' }, { status: 400 });

    // Fetch existing member row
    const { data: member, error: fetchErr } = await sb
      .from('user_group_members')
      .select('*')
      .eq('id', memberId)
      .single();
    if (fetchErr || !member) return json({ error: 'Member not found' }, { status: 404 });

    const currentIds: string[] = Array.isArray(member.location_ids) ? member.location_ids : [];
    const updatedIds = assign
      ? currentIds.includes(locationId) ? currentIds : [...currentIds, locationId]
      : currentIds.filter((id: string) => id !== locationId);

    // Update user_group_members.location_ids
    const { error: updateErr } = await sb
      .from('user_group_members')
      .update({ location_ids: updatedIds })
      .eq('id', memberId);
    if (updateErr) return json({ error: updateErr.message }, { status: 500 });

    // Sync location_users table
    if (assign) {
      // Upsert into location_users
      await sb.from('location_users').upsert(
        { location_id: locationId, user_email: member.user_email, user_id: member.user_id },
        { onConflict: 'location_id,user_email' }
      );
    } else {
      // Remove from location_users
      await sb.from('location_users')
        .delete()
        .eq('location_id', locationId)
        .eq('user_email', member.user_email);
    }

    return json({ ok: true, location_ids: updatedIds });
  }

  return json({ error: `Unknown action: ${action}` }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Email template helpers
// ---------------------------------------------------------------------------
function buildWelcomeHtml(email: string, password: string, name?: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:Inter,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px;font-weight:700;">HELIXO</h1>
    <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:12px;letter-spacing:1px;">PERFORMANCE DASHBOARD</p>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
    <h2 style="color:#1e3a5f;margin:0 0 16px;font-size:20px;">Welcome to HELIXO${name ? ', ' + name : ''}!</h2>
    <p style="color:#374151;line-height:1.7;margin:0 0 20px;">Your account has been created. Log in to view KPI reports, forecasts, labor analytics, and more.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="color:#6b7280;padding:4px 0;width:100px;">Email:</td><td style="color:#111827;font-weight:600;">${email}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0;">Password:</td><td style="color:#111827;font-weight:600;">${password}</td></tr>
      </table>
    </div>
    <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">You will be asked to change your password after your first login.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://helixokpi.com/login" style="display:inline-block;background:#1e3a5f;color:#fff;padding:14px 40px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">Log In to HELIXO</a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;">HELIXO &#124; helixokpi.com</p>
  </div>
</div></body></html>`;
}

function buildResetHtml(resetLink: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:Inter,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:3px;font-weight:700;">HELIXO</h1>
    <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:12px;letter-spacing:1px;">PERFORMANCE DASHBOARD</p>
  </div>
  <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
    <h2 style="color:#1e3a5f;margin:0 0 16px;font-size:20px;">Password Reset Request</h2>
    <p style="color:#374151;line-height:1.7;margin:0 0 20px;">Click the button below to set a new password.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${resetLink}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:14px 40px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">Reset Your Password</a>
    </div>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">If you did not request this, you can safely ignore this email.</p>
    <p style="color:#9ca3af;font-size:12px;margin:0;">This link expires in 24 hours.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;">HELIXO &#124; helixokpi.com</p>
  </div>
</div></body></html>`;
}
