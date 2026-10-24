<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let locationId = $state('');
  let locations = $state<any[]>([]);
  let questionnaire = $state<any>(null);
  let loading = $state(true);
  let saving = $state(false);
  let submitting = $state(false);
  let reviewing = $state(false);
  let message = $state('');
  let isAdmin = $state(false);
  let authChecked = $state(false);
  let userEmail = $state('');
  let adminNotes = $state('');

  // Role-based access — admin check via API

  // ---------------------------------------------------------------------------
  // Questions definition
  // ---------------------------------------------------------------------------
  interface QuestionDef {
    id: number;
    category: string;
    text: string;
    type: 'radio' | 'multi';
    options: string[];
  }

  const questions: QuestionDef[] = [
    // Service Model & Concept (Q1-5)
    { id: 1, category: 'Service Model & Concept', text: 'What is the restaurant\'s service style?', type: 'radio',
      options: ['Fine Dining', 'Upscale Casual', 'Casual', 'Fast Casual', 'Counter Service'] },
    { id: 2, category: 'Service Model & Concept', text: 'What is the average guest dwell time?', type: 'radio',
      options: ['Under 45 min', '45-75 min', '75-105 min', 'Over 105 min'] },
    { id: 3, category: 'Service Model & Concept', text: 'What is the average check per cover?', type: 'radio',
      options: ['$0-25', '$25-50', '$50-75', '$75-100', '$100+'] },
    { id: 4, category: 'Service Model & Concept', text: 'How many revenue centers does the restaurant operate?', type: 'radio',
      options: ['1', '2', '3', '4+'] },
    { id: 5, category: 'Service Model & Concept', text: 'Does the restaurant offer any auxiliary services?', type: 'multi',
      options: ['Brunch', 'Late Night', 'Private Events', 'Catering', 'Takeout', 'Delivery', 'None'] },

    // Volume & Capacity (Q6-10)
    { id: 6, category: 'Volume & Capacity', text: 'What is the restaurant\'s total seated capacity?', type: 'radio',
      options: ['Under 50', '50-100', '100-150', '150-200', '200+'] },
    { id: 7, category: 'Volume & Capacity', text: 'What is the average daily cover count?', type: 'radio',
      options: ['Under 75', '75-150', '150-250', '250-400', '400+'] },
    { id: 8, category: 'Volume & Capacity', text: 'What percentage of covers come from reservations vs walk-ins?', type: 'radio',
      options: ['90%+ reserved', '70-90%', '50-70%', 'Under 50%'] },
    { id: 9, category: 'Volume & Capacity', text: 'How many meal periods does the restaurant serve per day?', type: 'radio',
      options: ['1', '2', '3', '4+'] },
    { id: 10, category: 'Volume & Capacity', text: 'What is the typical peak-to-trough volume ratio?', type: 'radio',
      options: ['Less than 2x', '2-3x', '3-4x', 'Over 4x'] },

    // Kitchen & Menu Complexity (Q11-14)
    { id: 11, category: 'Kitchen & Menu Complexity', text: 'How many active menu items does the kitchen produce?', type: 'radio',
      options: ['Under 20', '20-40', '40-60', '60+'] },
    { id: 12, category: 'Kitchen & Menu Complexity', text: 'What is the kitchen\'s prep complexity level?', type: 'radio',
      options: ['Minimal — mostly ready-to-cook', 'Moderate — daily prep required', 'High — extensive from-scratch', 'Very High — in-house butchering, pastry, fermentation'] },
    { id: 13, category: 'Kitchen & Menu Complexity', text: 'Does the kitchen operate a dedicated pastry/bakery program?', type: 'radio',
      options: ['Yes, full program', 'Yes, limited', 'No'] },
    { id: 14, category: 'Kitchen & Menu Complexity', text: 'What is the plating complexity?', type: 'radio',
      options: ['Simple — plate and serve', 'Moderate — some garnish work', 'High — multi-component plating', 'Very High — fine dining presentation'] },

    // FOH Structure (Q15-17)
    { id: 15, category: 'FOH Structure', text: 'What is the target server-to-cover ratio during peak?', type: 'radio',
      options: ['1:8 or fewer', '1:10', '1:12', '1:15', '1:18+'] },
    { id: 16, category: 'FOH Structure', text: 'Does the restaurant use dedicated support staff?', type: 'multi',
      options: ['Bussers', 'Runners', 'Expos', 'Barbacks', 'Polishers', 'None'] },
    { id: 17, category: 'FOH Structure', text: 'What bar program complexity does the restaurant have?', type: 'radio',
      options: ['Full craft cocktail', 'Standard cocktail + wine', 'Beer/wine only', 'No bar'] },

    // Operational Factors (Q18-20)
    { id: 18, category: 'Operational Factors', text: 'What is the restaurant\'s labor market difficulty?', type: 'radio',
      options: ['Easy — abundant candidates', 'Moderate', 'Difficult — competitive market', 'Very Difficult — chronic understaffing'] },
    { id: 19, category: 'Operational Factors', text: 'How many hours per week does the restaurant operate?', type: 'radio',
      options: ['Under 50', '50-70', '70-90', '90+'] },
    { id: 20, category: 'Operational Factors', text: 'What percentage of the team is cross-trained for multiple positions?', type: 'radio',
      options: ['Under 10%', '10-25%', '25-50%', 'Over 50%'] },
  ];

  // Group questions by category
  const categories = [...new Set(questions.map(q => q.category))];
  function questionsByCategory(cat: string) {
    return questions.filter(q => q.category === cat);
  }

  // ---------------------------------------------------------------------------
  // Responses state: { [questionId]: { answer, notes } }
  // ---------------------------------------------------------------------------
  let answers = $state<Record<number, { answer: string | string[]; notes: string }>>({});

  // Initialize empty answers
  function initAnswers() {
    const init: Record<number, { answer: string | string[]; notes: string }> = {};
    for (const q of questions) {
      init[q.id] = { answer: q.type === 'multi' ? [] : '', notes: '' };
    }
    return init;
  }

  // Load existing responses into state
  function loadResponses(responses: any[]) {
    const loaded = initAnswers();
    for (const r of responses) {
      if (loaded[r.questionId]) {
        loaded[r.questionId] = { answer: r.answer ?? '', notes: r.notes ?? '' };
      }
    }
    answers = loaded;
  }

  // Convert state to array for storage
  function toResponsesArray(): any[] {
    return Object.entries(answers).map(([qId, val]) => ({
      questionId: parseInt(qId),
      answer: val.answer,
      notes: val.notes || undefined,
    }));
  }

  // Completion tracking
  let answeredCount = $derived(
    Object.entries(answers).filter(([_, val]) => {
      if (Array.isArray(val.answer)) return val.answer.length > 0;
      return val.answer !== '';
    }).length
  );
  let completionPct = $derived(Math.round((answeredCount / questions.length) * 100));

  // Radio answer helper
  function setRadioAnswer(qId: number, value: string) {
    answers[qId] = { ...answers[qId], answer: value };
  }

  // Multi-select toggle
  function toggleMultiAnswer(qId: number, value: string) {
    const current = (answers[qId]?.answer as string[]) || [];
    // If selecting "None", clear everything else
    if (value === 'None') {
      answers[qId] = { ...answers[qId], answer: ['None'] };
      return;
    }
    // Remove "None" if selecting something else
    const filtered = current.filter(v => v !== 'None');
    if (filtered.includes(value)) {
      answers[qId] = { ...answers[qId], answer: filtered.filter(v => v !== value) };
    } else {
      answers[qId] = { ...answers[qId], answer: [...filtered, value] };
    }
  }

  function setNotes(qId: number, notes: string) {
    answers[qId] = { ...answers[qId], notes };
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function loadQuestionnaire() {
    if (!locationId) return;
    loading = true;
    message = '';
    try {
      const res = await fetch(`/api/v1/admin/questionnaire?locationId=${locationId}`);
      const data = await res.json();
      questionnaire = data.questionnaire;
      if (questionnaire?.responses) {
        loadResponses(questionnaire.responses);
        adminNotes = questionnaire.admin_notes || '';
      } else {
        answers = initAnswers();
        adminNotes = '';
      }
    } catch (err: any) {
      message = 'Error loading questionnaire: ' + err.message;
      answers = initAnswers();
    }
    loading = false;
  }

  // ---------------------------------------------------------------------------
  // Save / Submit
  // ---------------------------------------------------------------------------
  async function save(status: 'draft' | 'submitted') {
    if (status === 'draft') saving = true;
    else submitting = true;
    message = '';

    try {
      const res = await fetch('/api/v1/admin/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          responses: toResponsesArray(),
          submittedBy: userEmail,
          status,
          id: questionnaire?.id || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        questionnaire = data.questionnaire;
        if (questionnaire?.responses) loadResponses(questionnaire.responses);
        message = status === 'submitted'
          ? 'Questionnaire submitted for review.'
          : 'Draft saved.';
      } else {
        message = 'Error: ' + (data.error || 'Failed to save');
      }
    } catch (err: any) {
      message = 'Error: ' + err.message;
    }
    saving = false;
    submitting = false;
  }

  // ---------------------------------------------------------------------------
  // Admin review
  // ---------------------------------------------------------------------------
  async function reviewAction(status: 'approved' | 'denied') {
    if (!questionnaire?.id) return;
    reviewing = true;
    message = '';

    try {
      const res = await fetch('/api/v1/admin/questionnaire', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: questionnaire.id,
          status,
          adminNotes,
          reviewedBy: userEmail,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        questionnaire = data.questionnaire;
        message = `Questionnaire ${status}.`;
      } else {
        message = 'Error: ' + (data.error || 'Failed to update');
      }
    } catch (err: any) {
      message = 'Error: ' + err.message;
    }
    reviewing = false;
  }

  // ---------------------------------------------------------------------------
  // Status badge styling
  // ---------------------------------------------------------------------------
  function statusBadgeStyle(s: string): string {
    switch (s) {
      case 'draft': return 'background: #f3f4f6; color: #374151;';
      case 'submitted': return 'background: #eff6ff; color: #1e40af;';
      case 'approved': return 'background: #f0fdf4; color: #16a34a;';
      case 'denied': return 'background: #fef2f2; color: #dc2626;';
      default: return 'background: #f3f4f6; color: #374151;';
    }
  }

  // ---------------------------------------------------------------------------
  // Auth check + initial load
  // ---------------------------------------------------------------------------
  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email ?? '';
      userEmail = email;
      if (email) {
        try {
          const _roleCtrl = new AbortController(); setTimeout(() => _roleCtrl.abort(), 8000); const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _roleCtrl.signal });
          if (res.ok) {
            const data = await res.json();
            isAdmin = data.permissions?.admin ?? false;
          }
        } catch { isAdmin = false; }
      }
      authChecked = true;
      if (!email) { goto('/login'); return; }

      const locUrl = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(locUrl).then(r => r.json()).then(d => {
        locations = d.locations || d || [];
        if (locations.length > 0 && !locationId) {
          const saved = localStorage.getItem('helixo_selected_location');
          locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
        }
        loadQuestionnaire();
      });
    });
  });

  // Status helpers
  let isReadOnly = $derived(questionnaire?.status === 'submitted' || questionnaire?.status === 'approved');
  let showAdjustments = $derived(
    questionnaire?.status === 'submitted' ||
    questionnaire?.status === 'approved' ||
    questionnaire?.status === 'denied'
  );
</script>

<div class="p-3 md:p-4 max-w-[1100px] mx-auto">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
    <div>
      <a href="/dashboard/settings" class="text-xs text-[#6b7280] hover:text-[#1e3a5f] transition-colors">&larr; Back to Settings</a>
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a] mt-1">Labor Needs Questionnaire</h1>
      <p class="text-sm text-[#6b7280] mt-1">Evaluate your restaurant's labor structure to justify labor thresholds and staffing levels.</p>
    </div>
    <div class="flex items-center gap-3">
      {#if questionnaire?.status}
        <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide"
          style={statusBadgeStyle(questionnaire.status)}>
          {questionnaire.status}
        </span>
      {/if}
      <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); loadQuestionnaire(); }} class="leo-select">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
    </div>
  </div>

  {#if loading}
    <div class="leo-card p-8 text-center">
      <p class="text-sm text-[#9ca3af]">Loading questionnaire...</p>
    </div>
  {:else}
    <!-- Progress bar -->
    <div class="leo-card p-4 mb-6">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-[#374151]">Progress</span>
        <span class="text-sm font-semibold text-[#1e3a5f]">{answeredCount} / {questions.length} questions ({completionPct}%)</span>
      </div>
      <div class="w-full rounded-full h-2.5" style="background: #e5e7eb;">
        <div class="h-2.5 rounded-full transition-all duration-300"
          style="width: {completionPct}%; background: {completionPct === 100 ? '#16a34a' : '#1e3a5f'};"></div>
      </div>
    </div>

    <!-- Questions by category -->
    {#each categories as category, catIdx}
      <div class="mb-8">
        <div class="flex items-center gap-3 mb-4">
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white"
            style="background: #1e3a5f;">{catIdx + 1}</span>
          <h2 class="text-lg font-semibold text-[#1a1a1a]">{category}</h2>
        </div>

        {#each questionsByCategory(category) as q}
          <div class="leo-card p-5 mb-3">
            <div class="flex items-start gap-3 mb-3">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium flex-shrink-0"
                style="background: {(Array.isArray(answers[q.id]?.answer) ? (answers[q.id]?.answer as string[]).length > 0 : answers[q.id]?.answer) ? '#f0fdf4; color: #16a34a;' : '#f3f4f6; color: #6b7280;'}">
                {q.id}
              </span>
              <p class="text-sm font-medium text-[#1a1a1a] leading-relaxed">{q.text}</p>
            </div>

            <!-- Answer options -->
            <div class="ml-9 space-y-2">
              {#if q.type === 'radio'}
                {#each q.options as opt}
                  <label class="flex items-center gap-3 cursor-pointer group py-1.5 px-3 rounded-lg transition-colors"
                    style="background: {answers[q.id]?.answer === opt ? '#eff6ff' : 'transparent'};">
                    <input type="radio" name="q_{q.id}" value={opt}
                      checked={answers[q.id]?.answer === opt}
                      onchange={() => setRadioAnswer(q.id, opt)}
                      disabled={isReadOnly}
                      class="w-4 h-4 accent-[#1e3a5f]" />
                    <span class="text-sm text-[#374151]">{opt}</span>
                  </label>
                {/each}
              {:else}
                <div class="flex flex-wrap gap-2">
                  {#each q.options as opt}
                    {@const selected = Array.isArray(answers[q.id]?.answer) && (answers[q.id]?.answer as string[]).includes(opt)}
                    <button
                      onclick={() => toggleMultiAnswer(q.id, opt)}
                      disabled={isReadOnly}
                      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border"
                      style="{selected
                        ? 'background: #1e3a5f; color: white; border-color: #1e3a5f;'
                        : 'background: white; color: #374151; border-color: #e5e7eb;'}"
                    >
                      {opt}
                    </button>
                  {/each}
                </div>
              {/if}

              <!-- Notes field -->
              <div class="mt-3">
                <input type="text"
                  placeholder="Additional notes (optional)"
                  value={answers[q.id]?.notes || ''}
                  oninput={(e) => setNotes(q.id, (e.target as HTMLInputElement).value)}
                  disabled={isReadOnly}
                  class="leo-input w-full text-xs"
                  style="background: #fafafa;" />
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/each}

    <!-- Suggested Threshold Adjustments (after submission) -->
    {#if showAdjustments && questionnaire?.threshold_adjustments}
      {@const adj = questionnaire.threshold_adjustments}
      <div class="leo-card p-6 mb-6" style="border-left: 4px solid #1e3a5f;">
        <h2 class="text-lg font-semibold text-[#1a1a1a] mb-3">Suggested Threshold Adjustments</h2>
        <p class="text-xs text-[#6b7280] mb-4">Based on questionnaire responses, the following labor allocation adjustments are recommended.</p>

        {#if adj.suggestions?.length > 0}
          <div class="space-y-2 mb-4">
            {#each adj.suggestions as suggestion}
              <div class="flex items-start gap-2 py-2 px-3 rounded-lg" style="background: #f8fafc;">
                <span class="text-[#1e3a5f] mt-0.5 flex-shrink-0">&#8227;</span>
                <p class="text-sm text-[#374151]">{suggestion}</p>
              </div>
            {/each}
          </div>
        {/if}

        {#if adj.laborPctModifiers && Object.keys(adj.laborPctModifiers).length > 0}
          <h3 class="text-sm font-semibold text-[#374151] mb-2">Labor % Modifiers</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {#each Object.entries(adj.laborPctModifiers) as [position, modifier]}
              <div class="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style="background: #f3f4f6;">
                <span class="capitalize text-[#374151]">{position.replace('_', ' ')}</span>
                <span class="font-semibold" style="color: {(modifier as number) > 0 ? '#16a34a' : '#dc2626'};">
                  {(modifier as number) > 0 ? '+' : ''}{((modifier as number) * 100).toFixed(1)}%
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Admin Review Panel -->
    {#if isAdmin && questionnaire?.status === 'submitted'}
      <div class="leo-card p-6 mb-6" style="border-left: 4px solid #f59e0b;">
        <h2 class="text-lg font-semibold text-[#1a1a1a] mb-3">Admin Review</h2>
        <p class="text-xs text-[#6b7280] mb-4">Review the submitted questionnaire and approve or deny the labor threshold adjustments.</p>

        <div class="mb-4">
          <label class="block text-xs text-[#6b7280] mb-1">Review Notes</label>
          <textarea bind:value={adminNotes} rows={3}
            class="leo-input w-full text-sm"
            placeholder="Add notes about your decision..."></textarea>
        </div>

        <div class="flex gap-3">
          <button onclick={() => reviewAction('approved')} disabled={reviewing}
            class="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style="background: #16a34a;">
            {reviewing ? 'Processing...' : 'Approve'}
          </button>
          <button onclick={() => reviewAction('denied')} disabled={reviewing}
            class="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style="background: #dc2626;">
            {reviewing ? 'Processing...' : 'Deny'}
          </button>
        </div>
      </div>
    {/if}

    <!-- Admin notes display (if reviewed) -->
    {#if questionnaire?.admin_notes && (questionnaire?.status === 'approved' || questionnaire?.status === 'denied')}
      <div class="leo-card p-5 mb-6" style="border-left: 4px solid {questionnaire.status === 'approved' ? '#16a34a' : '#dc2626'};">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm font-semibold text-[#374151]">Admin Review Notes</span>
          <span class="text-xs text-[#6b7280]">by {questionnaire.reviewed_by} on {new Date(questionnaire.reviewed_at).toLocaleDateString()}</span>
        </div>
        <p class="text-sm text-[#374151]">{questionnaire.admin_notes}</p>
      </div>
    {/if}

    <!-- Actions -->
    {#if !isReadOnly}
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 mt-6 mb-8">
        <button onclick={() => save('draft')} disabled={saving}
          class="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style="background: white; border: 1px solid #e5e7eb; color: #374151;">
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button onclick={() => save('submitted')} disabled={submitting || completionPct < 100}
          class="leo-btn"
          title={completionPct < 100 ? 'Answer all questions to submit' : ''}>
          {submitting ? 'Submitting...' : 'Submit for Review'}
        </button>
        {#if completionPct < 100}
          <span class="text-xs text-[#9ca3af]">Complete all 20 questions to submit.</span>
        {/if}
      </div>
    {:else if questionnaire?.status === 'denied'}
      <div class="flex gap-3 mt-6 mb-8">
        <button onclick={() => { questionnaire = { ...questionnaire, status: 'draft' }; }}
          class="leo-btn">
          Revise & Resubmit
        </button>
      </div>
    {/if}

    <!-- Message -->
    {#if message}
      <div class="p-4 rounded-lg text-sm mb-6"
        style="background: {message.includes('Error') ? '#fef2f2; color: #dc2626;' : '#f0fdf4; color: #16a34a;'}">
        {message}
      </div>
    {/if}
  {/if}
</div>
