import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

/**
 * Restaurant Labor Questionnaire CRUD API.
 *
 * GET  ?locationId=xxx                — Fetch latest questionnaire for a location
 * POST { locationId, responses, submittedBy, status }  — Save/submit questionnaire
 * PUT  { id, status, adminNotes, reviewedBy, thresholdAdjustments } — Admin approve/deny
 */

// ---------------------------------------------------------------------------
// Threshold adjustment logic based on questionnaire responses
// ---------------------------------------------------------------------------
interface QuestionResponse {
  questionId: number;
  answer: string | string[];
  notes?: string;
}

function computeThresholdAdjustments(responses: QuestionResponse[]): Record<string, unknown> {
  const getAnswer = (qId: number): string | string[] | undefined =>
    responses.find((r) => r.questionId === qId)?.answer;

  const adjustments: Record<string, unknown> = {
    suggestions: [] as string[],
    laborPctModifiers: {} as Record<string, number>,
  };
  const suggestions = adjustments.suggestions as string[];
  const modifiers = adjustments.laborPctModifiers as Record<string, number>;

  // Q1: Service style
  const serviceStyle = getAnswer(1);
  if (serviceStyle === 'Fine Dining') {
    suggestions.push('Fine dining service model suggests higher FOH labor allocation (+2-3% server labor).');
    modifiers.server = (modifiers.server || 0) + 0.025;
    modifiers.support = (modifiers.support || 0) + 0.015;
  } else if (serviceStyle === 'Fast Casual' || serviceStyle === 'Counter Service') {
    suggestions.push('Fast-casual model allows leaner FOH staffing (-1-2% server labor).');
    modifiers.server = (modifiers.server || 0) - 0.015;
  }

  // Q2: Dwell time
  const dwellTime = getAnswer(2);
  if (dwellTime === 'Over 105 min') {
    suggestions.push('Extended dwell time (105+ min) increases table occupation, reducing turns — consider higher server allocation.');
    modifiers.server = (modifiers.server || 0) + 0.01;
  }

  // Q3: Average check
  const avgCheck = getAnswer(3);
  if (avgCheck === '$100+' || avgCheck === '$75-100') {
    suggestions.push('High average check per cover justifies premium service staffing levels.');
    modifiers.server = (modifiers.server || 0) + 0.01;
  }

  // Q4: Revenue centers
  const revenueCenters = getAnswer(4);
  if (revenueCenters === '4+') {
    suggestions.push('Multiple revenue centers (4+) require dedicated staff per zone — increase total labor allocation.');
    modifiers.server = (modifiers.server || 0) + 0.015;
    modifiers.bartender = (modifiers.bartender || 0) + 0.01;
  }

  // Q5: Auxiliary services
  const auxServices = getAnswer(5);
  if (Array.isArray(auxServices)) {
    if (auxServices.includes('Brunch') || auxServices.includes('Late Night')) {
      suggestions.push('Brunch/late-night services extend operating hours — factor in additional labor shifts.');
    }
    if (auxServices.includes('Private Events')) {
      suggestions.push('Private event hosting requires dedicated event staff allocation.');
    }
    if (auxServices.includes('Catering')) {
      suggestions.push('Catering program requires additional prep and logistics labor.');
      modifiers['prep_cooks'] = (modifiers['prep_cooks'] || 0) + 0.01;
    }
  }

  // Q6: Seated capacity
  const capacity = getAnswer(6);
  if (capacity === '200+') {
    suggestions.push('Large venue (200+ seats) requires proportionally more support staff (bussers, runners).');
    modifiers.support = (modifiers.support || 0) + 0.02;
  }

  // Q7: Daily covers
  const dailyCovers = getAnswer(7);
  if (dailyCovers === '400+') {
    suggestions.push('High daily volume (400+ covers) demands robust kitchen and FOH staffing.');
    modifiers['line_cooks'] = (modifiers['line_cooks'] || 0) + 0.015;
  }

  // Q10: Peak-to-trough ratio
  const peakTrough = getAnswer(10);
  if (peakTrough === 'Over 4x' || peakTrough === '3-4x') {
    suggestions.push('High peak-to-trough ratio suggests wider labor distribution curve — invest in flex scheduling.');
  }

  // Q11: Menu items
  const menuItems = getAnswer(11);
  if (menuItems === '60+') {
    suggestions.push('Extensive menu (60+ items) increases prep complexity — allocate more prep cook hours.');
    modifiers['prep_cooks'] = (modifiers['prep_cooks'] || 0) + 0.015;
  }

  // Q12: Prep complexity
  const prepComplexity = getAnswer(12);
  if (prepComplexity === 'Very High — in-house butchering, pastry, fermentation') {
    suggestions.push('Very high prep complexity (butchering, fermentation) justifies dedicated prep team and higher BOH labor %.');
    modifiers['prep_cooks'] = (modifiers['prep_cooks'] || 0) + 0.025;
  } else if (prepComplexity === 'High — extensive from-scratch') {
    suggestions.push('High from-scratch prep requires substantial daily prep labor allocation.');
    modifiers['prep_cooks'] = (modifiers['prep_cooks'] || 0) + 0.015;
  }

  // Q13: Pastry program
  const pastry = getAnswer(13);
  if (pastry === 'Yes, full program') {
    suggestions.push('Full pastry/bakery program requires dedicated pastry position labor.');
    modifiers.pastry = (modifiers.pastry || 0) + 0.02;
  }

  // Q14: Plating complexity
  const plating = getAnswer(14);
  if (plating === 'Very High — fine dining presentation') {
    suggestions.push('Fine dining plating increases ticket time — factor into line cook allocation.');
    modifiers['line_cooks'] = (modifiers['line_cooks'] || 0) + 0.01;
  }

  // Q15: Server-to-cover ratio
  const serverRatio = getAnswer(15);
  if (serverRatio === '1:8 or fewer') {
    suggestions.push('Tight server-to-cover ratio (1:8) indicates premium service — higher server labor % expected.');
    modifiers.server = (modifiers.server || 0) + 0.02;
  }

  // Q16: Support staff
  const supportStaff = getAnswer(16);
  if (Array.isArray(supportStaff)) {
    if (supportStaff.length >= 4) {
      suggestions.push('Extensive support staff roster (bussers, runners, expos, barbacks) increases total labor — ensure budgeted.');
      modifiers.support = (modifiers.support || 0) + 0.02;
    }
    if (supportStaff.includes('None') || supportStaff.length === 0) {
      suggestions.push('No dedicated support staff — servers handle all duties, which may cap volume efficiency.');
    }
  }

  // Q17: Bar program
  const barProgram = getAnswer(17);
  if (barProgram === 'Full craft cocktail') {
    suggestions.push('Full craft cocktail program requires higher bartender allocation and barback support.');
    modifiers.bartender = (modifiers.bartender || 0) + 0.02;
  }

  // Q18: Labor market
  const laborMarket = getAnswer(18);
  if (laborMarket === 'Very Difficult — chronic understaffing') {
    suggestions.push('Very difficult labor market — budget for higher wages / overtime to retain talent.');
  } else if (laborMarket === 'Difficult — competitive market') {
    suggestions.push('Competitive labor market — consider wage premiums in labor cost projections.');
  }

  // Q19: Hours per week
  const hoursPerWeek = getAnswer(19);
  if (hoursPerWeek === '90+') {
    suggestions.push('Extended operating hours (90+ hrs/week) significantly increases total labor — review overtime exposure.');
  }

  // Q20: Cross-training
  const crossTraining = getAnswer(20);
  if (crossTraining === 'Under 10%') {
    suggestions.push('Low cross-training (<10%) reduces scheduling flexibility — higher headcount needed for coverage.');
    modifiers.support = (modifiers.support || 0) + 0.01;
  } else if (crossTraining === 'Over 50%') {
    suggestions.push('Strong cross-training (50%+) enables flex scheduling — potential to run leaner.');
  }

  return adjustments;
}

// ---------------------------------------------------------------------------
// GET — fetch latest questionnaire for a location
// ---------------------------------------------------------------------------
export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  if (!locationId) {
    return json({ error: 'locationId is required' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { data, error } = await sb
    .from('restaurant_questionnaire')
    .select('*')
    .eq('location_id', locationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ questionnaire: data });
};

// ---------------------------------------------------------------------------
// POST — save/submit questionnaire
// ---------------------------------------------------------------------------
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { locationId, responses, submittedBy, status, id } = body;

  if (!locationId || !responses) {
    return json({ error: 'locationId and responses are required' }, { status: 400 });
  }

  const validStatuses = ['draft', 'submitted'];
  const finalStatus = validStatuses.includes(status) ? status : 'draft';

  // Compute threshold adjustments when submitting
  const thresholdAdjustments =
    finalStatus === 'submitted' ? computeThresholdAdjustments(responses) : {};

  const sb = getSupabaseService();

  // If updating an existing draft
  if (id) {
    const { data, error } = await sb
      .from('restaurant_questionnaire')
      .update({
        responses,
        submitted_by: submittedBy || null,
        status: finalStatus,
        threshold_adjustments: thresholdAdjustments,
        submitted_at: finalStatus === 'submitted' ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ questionnaire: data });
  }

  // Create new
  const { data, error } = await sb
    .from('restaurant_questionnaire')
    .insert({
      location_id: locationId,
      responses,
      submitted_by: submittedBy || null,
      status: finalStatus,
      threshold_adjustments: thresholdAdjustments,
      submitted_at: finalStatus === 'submitted' ? new Date().toISOString() : undefined,
    })
    .select()
    .single();

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ questionnaire: data });
};

// ---------------------------------------------------------------------------
// PUT — admin approve/deny
// ---------------------------------------------------------------------------
export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { id, status, adminNotes, reviewedBy } = body;

  if (!id) {
    return json({ error: 'id is required' }, { status: 400 });
  }

  const validStatuses = ['approved', 'denied'];
  if (!validStatuses.includes(status)) {
    return json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { data, error } = await sb
    .from('restaurant_questionnaire')
    .update({
      status,
      admin_notes: adminNotes || null,
      reviewed_by: reviewedBy || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ questionnaire: data });
};
