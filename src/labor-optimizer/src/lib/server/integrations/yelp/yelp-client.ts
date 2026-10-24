/**
 * Yelp Fusion API client.
 *
 * Fetches reviews and business details for integration with
 * the Guest Satisfaction Dashboard.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YelpReview {
  id: string;
  url: string;
  text: string;
  rating: number;
  time_created: string;
  user: {
    id: string;
    name: string;
    image_url: string | null;
  };
}

export interface YelpBusiness {
  id: string;
  name: string;
  rating: number;
  review_count: number;
  url: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const YELP_API_BASE = 'https://api.yelp.com/v3';

/**
 * Fetch recent reviews for a Yelp business.
 * The Fusion API returns up to 3 review excerpts per call.
 */
export async function fetchYelpReviews(
  businessId: string,
  apiKey: string,
): Promise<YelpReview[]> {
  const url = `${YELP_API_BASE}/businesses/${businessId}/reviews?sort_by=newest`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yelp API error ${res.status}: ${text}`);
  }

  const body = await res.json();
  return (body.reviews ?? []) as YelpReview[];
}

/**
 * Fetch business details (aggregate rating + review count).
 */
export async function fetchYelpBusiness(
  businessId: string,
  apiKey: string,
): Promise<YelpBusiness | null> {
  const url = `${YELP_API_BASE}/businesses/${businessId}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yelp API error ${res.status}: ${text}`);
  }

  const body = await res.json();

  return {
    id: body.id,
    name: body.name,
    rating: body.rating,
    review_count: body.review_count,
    url: body.url,
  };
}
