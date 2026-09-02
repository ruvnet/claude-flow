---
name: "CRM Onboarding Health Analysis"
description: "Analyze BestyCRM onboarding pipeline to identify at-risk accounts, diagnose health score gaps, and generate prioritized action plans for account managers."
version: "1.0.0"
category: "crm"
tags: ["crm", "onboarding", "health-score", "churn-prevention", "besty"]
---

# CRM Onboarding Health Analysis

## What This Skill Does

Analyzes the BestyCRM onboarding pipeline to surface accounts that need attention. It reads health scores (0-100), breaks down which of the six scoring dimensions are underperforming, and produces a prioritized action plan grouped by account manager.

## Health Score Model

Each account is scored on six dimensions:

| Dimension | Max | How to Improve |
|-----------|-----|----------------|
| Checklist progress | 30 | Complete PMS-specific onboarding items |
| Feature flags (10 key) | 25 | Enable missing flags (2.5 pts each) |
| Recency (last seen) | 15 | Re-engage inactive users |
| Primary contact linked | 10 | Link HubSpot contact |
| Stripe active/trialing | 10 | Complete billing setup |
| No listing errors | 10 | Resolve errored listings |

## Risk Tiers

| Tier | Score Range | Action |
|------|------------|--------|
| Critical | < 30 | Immediate intervention |
| At Risk | 30-50 | Proactive outreach |
| Needs Attention | 50-70 | Monitor and nudge |
| On Track | 70-85 | Light touch |
| Healthy | > 85 | Self-serve |

## Usage

### Analyze full pipeline
```
Analyze the onboarding pipeline for at-risk accounts and generate an action plan.
```

### Focus on a specific account manager
```
Show me all at-risk accounts assigned to Sarah with their score breakdowns.
```

### Track week-over-week changes
```
Compare this week's health scores against last week's analysis stored in memory.
```

## Approach

1. **Fetch** pipeline data from `/api/onboarding/pipeline`
2. **Triage** accounts into risk tiers by health score
3. **Diagnose** each at-risk account's score breakdown to find the biggest gaps
4. **Prioritize** actions by potential point impact (highest first)
5. **Group** recommendations by account manager for delegation
6. **Store** analysis in ruflo memory for historical comparison

## MCP Toolkit

```bash
# Store analysis results
npx claude-flow@v3alpha memory store --namespace crm --key "health-$(date +%Y%m%d)" --value "[results]"

# Search past analyses
npx claude-flow@v3alpha memory search --namespace crm --query "at-risk accounts"

# Retrieve previous analysis
npx claude-flow@v3alpha memory retrieve --namespace crm --key "health-20260414"
```
