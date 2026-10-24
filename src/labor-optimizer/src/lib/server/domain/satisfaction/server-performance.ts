/**
 * Server (staff) performance analytics from guest survey data.
 *
 * Aggregates per-server NPS, average scores, and mention counts
 * for a given location and date range.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerStats {
  serverName: string;
  totalSurveys: number;
  avgRecommend: number | null;
  avgService: number | null;
  avgFood: number | null;
  npsScore: number | null;
  positiveMentions: number;
  negativeMentions: number;
}

// ---------------------------------------------------------------------------
// Positive / negative keyword lists for simple mention counting
// ---------------------------------------------------------------------------

const POSITIVE_KEYWORDS = [
  'amazing', 'excellent', 'wonderful', 'fantastic', 'great', 'awesome',
  'perfect', 'outstanding', 'exceptional', 'friendly', 'attentive',
  'knowledgeable', 'helpful', 'professional', 'delightful',
];

const NEGATIVE_KEYWORDS = [
  'rude', 'slow', 'terrible', 'awful', 'horrible', 'worst', 'bad',
  'disappointing', 'inattentive', 'ignored', 'unfriendly', 'unprofessional',
  'mistake', 'wrong', 'cold',
];

function countMentions(comments: string[], keywords: string[]): number {
  let count = 0;
  for (const comment of comments) {
    const lower = comment.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        count++;
        break; // count each comment at most once
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Compute server performance
// ---------------------------------------------------------------------------

export async function computeServerPerformance(
  sb: SupabaseClient,
  locationId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ServerStats[]> {
  const { data: surveys, error } = await sb
    .from('guest_surveys')
    .select('server_name, recommend_score, service_score, food_score, comment')
    .eq('location_id', locationId)
    .gte('survey_date', dateFrom)
    .lte('survey_date', dateTo)
    .not('server_name', 'is', null);

  if (error) throw new Error(`Failed to fetch surveys: ${error.message}`);
  if (!surveys || surveys.length === 0) return [];

  // Group by server
  const byServer = new Map<string, typeof surveys>();
  for (const s of surveys) {
    const name = (s.server_name as string).trim();
    if (!name) continue;
    if (!byServer.has(name)) byServer.set(name, []);
    byServer.get(name)!.push(s);
  }

  const results: ServerStats[] = [];

  for (const [serverName, serverSurveys] of byServer) {
    const recommendScores = serverSurveys
      .filter((s) => s.recommend_score != null)
      .map((s) => s.recommend_score as number);

    const serviceScores = serverSurveys
      .filter((s) => s.service_score != null)
      .map((s) => s.service_score as number);

    const foodScores = serverSurveys
      .filter((s) => s.food_score != null)
      .map((s) => s.food_score as number);

    const comments = serverSurveys
      .filter((s) => s.comment)
      .map((s) => s.comment as string);

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    // NPS from recommend scores
    let promoters = 0;
    let detractors = 0;
    for (const score of recommendScores) {
      if (score >= 9) promoters++;
      else if (score <= 6) detractors++;
    }
    const total = recommendScores.length;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;

    results.push({
      serverName,
      totalSurveys: serverSurveys.length,
      avgRecommend: avg(recommendScores),
      avgService: avg(serviceScores),
      avgFood: avg(foodScores),
      npsScore: nps,
      positiveMentions: countMentions(comments, POSITIVE_KEYWORDS),
      negativeMentions: countMentions(comments, NEGATIVE_KEYWORDS),
    });
  }

  // Sort by total surveys descending
  results.sort((a, b) => b.totalSurveys - a.totalSurveys);

  return results;
}
