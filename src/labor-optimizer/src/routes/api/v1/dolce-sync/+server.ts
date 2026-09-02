/**
 * Dolce Sync Trigger API
 *
 * POST — triggers the Dolce sync GitHub Action via workflow_dispatch.
 * Since Playwright cannot run on Vercel, this endpoint dispatches
 * the GitHub Action and returns immediately.
 *
 * Requires GITHUB_TOKEN secret with workflow dispatch permissions.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const GITHUB_OWNER = 'rrmethodco';
const GITHUB_REPO = 'ruflo';
const WORKFLOW_ID = 'dolce-sync.yml';

export const POST: RequestHandler = async ({ request }) => {
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    // If no GitHub token, return instructions
    return json({
      triggered: false,
      message: 'GITHUB_TOKEN not configured. Run the sync manually via GitHub Actions or CLI: npx tsx scripts/dolce-sync.ts',
    });
  }

  try {
    // Parse optional week parameter
    let weekStart: string | undefined;
    try {
      const body = await request.json();
      weekStart = body.weekStart;
    } catch {
      // no body is fine
    }

    const inputs: Record<string, string> = {};
    if (weekStart) {
      inputs.week = weekStart;
    }

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: 'feature/claude-agents-setup',
          inputs,
        }),
      },
    );

    if (res.status === 204 || res.ok) {
      return json({
        triggered: true,
        message: 'Dolce sync triggered. Check the Schedule tab in ~2 minutes for updated data.',
      });
    }

    const errorText = await res.text();
    return json(
      { triggered: false, message: `GitHub API error: ${res.status} ${errorText}` },
      { status: 502 },
    );
  } catch (err: any) {
    return json(
      { triggered: false, message: `Failed to trigger sync: ${err.message}` },
      { status: 500 },
    );
  }
};
