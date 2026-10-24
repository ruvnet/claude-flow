import { json, type RequestHandler } from '@sveltejs/kit';

// Toast POS webhook receiver (renamed from SpotOn per user preference)
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();

  // TODO: Validate webhook signature
  // TODO: Process Toast POS events:
  // - order_completed: update revenue data
  // - employee_clocked_in: update actual staffing
  // - employee_clocked_out: compute actual hours

  console.log('[Webhook] Toast POS event received:', body.type || 'unknown');

  return json({ received: true });
};
