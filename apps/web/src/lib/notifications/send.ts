/**
 * Server-side helper to send notifications.
 *
 * Uses the service-role client so it bypasses RLS (inserts for any user).
 */

import { SupabaseClient } from '@supabase/supabase-js';

export type NotificationType =
  | 'trade_offer'
  | 'trade_accepted'
  | 'trade_rejected'
  | 'challenge_received'
  | 'challenge_accepted'
  | 'challenge_declined'
  | 'game_result'
  | 'system';

export interface NotificationPayload {
  message: string;
  [key: string]: unknown;
}

/**
 * Send a notification to a user. Must be called with a service-role client.
 */
export async function sendNotification(
  supabase: SupabaseClient,
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    type,
    payload,
  });

  if (error) {
    throw new Error(`Failed to send notification: ${error.message}`);
  }
}

/**
 * Send the same notification to multiple users.
 */
export async function sendNotificationBulk(
  supabase: SupabaseClient,
  userIds: string[],
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  if (userIds.length === 0) return;

  const rows = userIds.map((userId) => ({
    user_id: userId,
    type,
    payload,
  }));

  const { error } = await supabase.from('notifications').insert(rows);

  if (error) {
    throw new Error(`Failed to send bulk notifications: ${error.message}`);
  }
}
