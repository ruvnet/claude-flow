/**
 * Utility for recording system learnings to the system_learnings table.
 * Used by self-learning backend systems to capture insights.
 */

import { getSupabaseService } from '$lib/server/supabase';

export type LearningCategory = 'forecast' | 'labor' | 'weather' | 'scheduling' | 'sales_mix';

interface RecordLearningParams {
  locationId?: string | null;
  category: LearningCategory;
  learning: string;
  source: string;
  confidence?: number;
}

/**
 * Record a system learning. Silently fails to avoid disrupting critical paths.
 */
export async function recordLearning(params: RecordLearningParams): Promise<void> {
  try {
    const sb = getSupabaseService();
    await sb.from('system_learnings').insert({
      location_id: params.locationId || null,
      category: params.category,
      learning: params.learning,
      source: params.source,
      confidence: params.confidence ?? 0.5,
    });
  } catch {
    // Non-critical — never fail the calling operation
  }
}
