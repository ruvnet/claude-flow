import { getSupabaseService } from '$lib/server/supabase';

export type NotificationType =
  | 'schedule_submitted'
  | 'schedule_approved'
  | 'schedule_denied'
  | 'schedule_revision'
  | 'forecast_submitted'
  | 'forecast_locked';

export interface CreateNotificationInput {
  userEmail: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  locationId?: string;
  metadata?: Record<string, unknown>;
}

/** Create one or many notifications (server-side only, uses service role). */
export async function createNotification(
  input: CreateNotificationInput | CreateNotificationInput[],
): Promise<void> {
  const sb = getSupabaseService();
  const rows = Array.isArray(input) ? input : [input];
  const inserts = rows.map((r) => ({
    user_email: r.userEmail,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    location_id: r.locationId ?? null,
    metadata: r.metadata ?? null,
  }));
  const { error } = await sb.from('notifications').insert(inserts);
  if (error) console.error('[notifications] insert error:', error.message);
}
