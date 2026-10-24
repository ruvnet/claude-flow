/**
 * Alert engine for the Guest Satisfaction Dashboard.
 *
 * Checks for NPS drops, low ratings, negative trends, and data gaps.
 * Creates alerts in the satisfaction_alerts table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getNpsForPeriod } from './nps-calculator';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const NPS_CRITICAL_THRESHOLD = 0;
const NPS_WARNING_THRESHOLD = 20;
const NPS_DROP_THRESHOLD = 15; // drop of 15+ points triggers alert
const NO_DATA_DAYS_THRESHOLD = 14;

// ---------------------------------------------------------------------------
// Run all alert checks for a location
// ---------------------------------------------------------------------------

export async function runAlertChecks(
  sb: SupabaseClient,
  locationId: string,
  locationName: string,
): Promise<number> {
  let alertsCreated = 0;

  // 1. Check current NPS level
  const nps30 = await getNpsForPeriod(sb, locationId, 30);
  if (nps30.total >= 5) {
    if (nps30.nps <= NPS_CRITICAL_THRESHOLD) {
      alertsCreated += await createAlertIfNew(sb, locationId, {
        alert_type: 'low_rating',
        severity: 'critical',
        title: `${locationName}: NPS is critically low (${nps30.nps})`,
        description: `30-day NPS score of ${nps30.nps} from ${nps30.total} responses is at or below 0.`,
        metric_value: nps30.nps,
        threshold_value: NPS_CRITICAL_THRESHOLD,
      });
    } else if (nps30.nps <= NPS_WARNING_THRESHOLD) {
      alertsCreated += await createAlertIfNew(sb, locationId, {
        alert_type: 'low_rating',
        severity: 'warning',
        title: `${locationName}: NPS below threshold (${nps30.nps})`,
        description: `30-day NPS score of ${nps30.nps} from ${nps30.total} responses is below ${NPS_WARNING_THRESHOLD}.`,
        metric_value: nps30.nps,
        threshold_value: NPS_WARNING_THRESHOLD,
      });
    }
  }

  // 2. Check for NPS drop (compare 30d to prior 30d)
  const nps60 = await getNpsForPeriod(sb, locationId, 60);
  if (nps30.total >= 5 && nps60.total > nps30.total) {
    const priorTotal = nps60.total - nps30.total;
    const priorPromoters = nps60.promoters - nps30.promoters;
    const priorDetractors = nps60.detractors - nps30.detractors;
    const priorNps = priorTotal > 0
      ? Math.round(((priorPromoters - priorDetractors) / priorTotal) * 100)
      : 0;
    const drop = priorNps - nps30.nps;

    if (drop >= NPS_DROP_THRESHOLD) {
      alertsCreated += await createAlertIfNew(sb, locationId, {
        alert_type: 'nps_drop',
        severity: drop >= 25 ? 'critical' : 'warning',
        title: `${locationName}: NPS dropped ${drop} points`,
        description: `NPS fell from ${priorNps} to ${nps30.nps} over the last 30 days.`,
        metric_value: drop,
        threshold_value: NPS_DROP_THRESHOLD,
      });
    }
  }

  // 3. Check for no survey data
  const { data: recentSurveys } = await sb
    .from('guest_surveys')
    .select('id')
    .eq('location_id', locationId)
    .gte('survey_date', new Date(Date.now() - NO_DATA_DAYS_THRESHOLD * 86400000).toISOString().split('T')[0])
    .limit(1);

  if (!recentSurveys || recentSurveys.length === 0) {
    alertsCreated += await createAlertIfNew(sb, locationId, {
      alert_type: 'no_data',
      severity: 'warning',
      title: `${locationName}: No survey data in ${NO_DATA_DAYS_THRESHOLD} days`,
      description: `No guest survey responses received in the last ${NO_DATA_DAYS_THRESHOLD} days. Check Resy CSV uploads.`,
      metric_value: NO_DATA_DAYS_THRESHOLD,
      threshold_value: NO_DATA_DAYS_THRESHOLD,
    });
  }

  // 4. Check for NPS milestone (positive)
  if (nps30.total >= 10 && nps30.nps >= 70) {
    alertsCreated += await createAlertIfNew(sb, locationId, {
      alert_type: 'milestone',
      severity: 'info',
      title: `${locationName}: Excellent NPS of ${nps30.nps}`,
      description: `Congratulations! 30-day NPS of ${nps30.nps} from ${nps30.total} responses.`,
      metric_value: nps30.nps,
      threshold_value: 70,
    });
  }

  return alertsCreated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AlertInput {
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  metric_value: number;
  threshold_value: number;
}

/**
 * Create an alert only if there is no unresolved alert of the same type
 * for this location in the last 7 days.
 */
async function createAlertIfNew(
  sb: SupabaseClient,
  locationId: string,
  alert: AlertInput,
): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: existing } = await sb
    .from('satisfaction_alerts')
    .select('id')
    .eq('location_id', locationId)
    .eq('alert_type', alert.alert_type)
    .eq('is_resolved', false)
    .gte('created_at', weekAgo)
    .limit(1);

  if (existing && existing.length > 0) return 0;

  const { error } = await sb.from('satisfaction_alerts').insert({
    location_id: locationId,
    ...alert,
  });

  if (error) {
    console.error(`[alert] Failed to create alert: ${error.message}`);
    return 0;
  }

  return 1;
}
