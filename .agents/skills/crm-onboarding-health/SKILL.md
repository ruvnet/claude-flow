---
name: crm-onboarding-health
version: 1.0.0
description: BestyCRM onboarding health analysis — identifies at-risk accounts, diagnoses score breakdowns, and recommends next actions for account managers
category: crm
tags: [crm, onboarding, health-score, churn-prevention, account-management, besty]
author: BestyCRM Team
---

# CRM Onboarding Health Skill

Analyzes BestyCRM onboarding pipeline data to identify at-risk accounts, break down health score components, and generate prioritized action plans for account managers.

## Overview

BestyCRM computes a 0-100 health score for each onboarding account based on six weighted dimensions:

| Component | Max Points | Source |
|-----------|-----------|--------|
| Checklist progress | 30 | PMS-specific checklist completion % |
| Feature flags enabled | 25 | 10 key flags (2.5 pts each) |
| Recency (last seen) | 15 | 1d=15, 7d=10, 14d=5, else 0 |
| Primary contact linked | 10 | HubSpot contact match |
| Stripe setup complete | 10 | Subscription active or trialing |
| No listings in error | 10 | Zero `numListingsInError` |

This skill teaches agents to read pipeline data, diagnose which dimensions are dragging a score down, and recommend concrete next steps.

## Key Feature Flags

The 10 key flags tracked for scoring:

1. `bffReadyToSeeApp` — App visibility enabled
2. `bff100PercentLiveAndSendingMessages` — Fully live messaging
3. `autopilotEnabled` — Autopilot mode on
4. `opsLive` — Operations live
5. `bookingBoosterEnabled` — Booking booster active
6. `instantMessagingModeEnabled` — IM mode on
7. `whatsappLive` — WhatsApp connected
8. `hasPmsCreds` — PMS credentials configured
9. `twoFaCompleted` — 2FA setup done
10. `voiceRouting` — Voice routing configured

## Agent Behavior

When invoked, the agent should:

### 1. Fetch Pipeline Data
Read from the `/api/onboarding/pipeline` endpoint which returns an array of accounts with:
- `healthScore` (0-100)
- `checklist` ({ completed, total, percent })
- `featureFlags` (object with boolean values)
- `lastSeenAt`, `hasContact`, `stripeStatus`
- `numListings`, `numListingsEnabled`, `numListingsInError`
- `accountManagerName`, `pms`, `plan`

### 2. Triage Accounts
Classify accounts into risk buckets:
- **Critical** (score < 30): Immediate intervention needed
- **At Risk** (score 30-50): Proactive outreach recommended
- **Needs Attention** (score 50-70): Monitor and nudge
- **On Track** (score 70-85): Light touch
- **Healthy** (score > 85): Self-serve

### 3. Diagnose Score Gaps
For each at-risk account, identify which dimensions are costing the most points:
- Missing checklist items → list the incomplete ones
- Disabled feature flags → list which flags to enable
- Inactive (not seen recently) → flag for re-engagement
- No primary contact → flag for HubSpot linking
- Stripe not active → flag for billing setup
- Listings in error → flag for ops review

### 4. Generate Action Plan
Output a prioritized list of actions per account, ordered by point impact:
- Highest-impact actions first (e.g., "Enable autopilot" = 2.5 pts)
- Group by account manager for delegation
- Include estimated score improvement per action

## Example Output

```
## At-Risk Accounts (3 accounts below score 50)

### 1. Acme Vacation Rentals (Score: 28/100)
   Account Manager: Sarah
   PMS: Streamline | Plan: Pro | Listings: 45

   Score Breakdown:
   - Checklist: 5/30 (17% complete — 3 of 18 items done)
   - Feature Flags: 5/25 (2 of 10 enabled)
   - Last Seen: 0/15 (last seen 22 days ago)
   - Contact: 10/10 ✓
   - Stripe: 8/10 (trialing)
   - Listings: 0/10 (3 listings in error)

   Recommended Actions (ordered by impact):
   1. Complete checklist items (potential +25 pts)
      - Connect PMS credentials
      - Enable autopilot
      - Set up WhatsApp
      ...
   2. Enable feature flags (potential +20 pts)
      - autopilotEnabled, whatsappLive, voiceRouting, ...
   3. Re-engage user (potential +15 pts)
      - Not seen in 22 days — schedule check-in call
   4. Fix listing errors (potential +10 pts)
      - 3 listings in error state
```

## CLI Integration

```bash
# Spawn a health analysis agent
npx claude-flow@v3alpha agent spawn -t crm-onboarding-health --name health-analyst

# Store analysis results in memory
npx claude-flow@v3alpha memory store --namespace crm --key "health-analysis-$(date +%Y%m%d)" --value "[analysis JSON]"

# Search past analyses
npx claude-flow@v3alpha memory search --namespace crm --query "at-risk accounts"
```

## Swarm Integration

Use in a CRM analysis swarm:

```javascript
// Spawn alongside other CRM agents
Agent("HealthAnalyst", "Analyze onboarding pipeline for at-risk accounts. Fetch /api/onboarding/pipeline, triage by health score, diagnose gaps, and generate action plans.", { subagent_type: "crm-onboarding-health", run_in_background: true })
Agent("ChurnPredictor", "Based on health analysis, predict which accounts are most likely to churn in the next 30 days.", { subagent_type: "researcher", run_in_background: true })
Agent("OutreachDrafter", "Draft personalized outreach messages for at-risk accounts based on their specific gaps.", { subagent_type: "coder", run_in_background: true })
```

## Data Source

- **API Endpoint**: `GET /api/onboarding/pipeline`
- **Source File**: `artifacts/api-server/src/routes/onboarding.ts`
- **Health Score Function**: `computeOnboardingHealthScore()`
- **Database Tables**: `users`, `checklistTemplates`, `checklistItems`, `checklistCompletions`, `contactMatches`, `stripeData`, `accountManagers`
