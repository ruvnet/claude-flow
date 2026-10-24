/**
 * Google Business Profile API client.
 *
 * Fetches aggregate rating summaries for a given Place ID
 * using the Google Places API (New).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleRatingSummary {
  averageRating: number;
  totalReviewCount: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places';

/**
 * Fetch the aggregate rating and total review count for a Google Place.
 * Uses the Places API (New) fields mask.
 */
export async function fetchGoogleRatingSummary(
  placeId: string,
  apiKey: string,
): Promise<GoogleRatingSummary | null> {
  const url = `${PLACES_API_BASE}/${placeId}?fields=rating,userRatingCount&key=${apiKey}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places API error ${res.status}: ${text}`);
  }

  const body = await res.json();

  if (body.rating == null && body.userRatingCount == null) {
    return null;
  }

  return {
    averageRating: body.rating ?? 0,
    totalReviewCount: body.userRatingCount ?? 0,
  };
}
