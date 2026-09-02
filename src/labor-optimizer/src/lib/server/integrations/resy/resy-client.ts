/**
 * Resy Reservations API Client
 *
 * Pulls reservation data for demand forecasting.
 */

interface ResyConfig {
	apiKey: string;
	venueId: string;
	baseUrl?: string;
}

export interface ResyReservation {
	token: string;
	date: string;
	time: string;
	partySize: number;
	status: 'confirmed' | 'cancelled' | 'no_show' | 'completed';
	createdAt: string;
}

interface ResyAvailability {
	date: string;
	totalReservations: number;
	totalCovers: number;
	byHour: { hour: number; reservations: number; covers: number }[];
}

export class ResyClient {
	private config: ResyConfig;

	constructor(config: ResyConfig) {
		this.config = {
			...config,
			baseUrl: config.baseUrl || 'https://api.resy.com',
		};
	}

	/** Make authenticated request to Resy API */
	private async request<T>(path: string): Promise<T> {
		const response = await fetch(`${this.config.baseUrl}${path}`, {
			headers: {
				'Authorization': `ResyAPI api_key="${this.config.apiKey}"`,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			throw new Error(`Resy API error: ${response.status} ${response.statusText}`);
		}

		return response.json();
	}

	/** Get reservations for a specific date */
	async getReservations(date: string): Promise<ResyReservation[]> {
		return this.request<ResyReservation[]>(
			`/4/venue/reservations?venue_id=${this.config.venueId}&date=${date}`
		);
	}

	/** Get reservation summary for demand forecasting */
	async getAvailabilitySummary(date: string): Promise<ResyAvailability> {
		const reservations = await this.getReservations(date);

		const confirmed = reservations.filter((r) => r.status === 'confirmed');
		const byHour: Record<number, { reservations: number; covers: number }> = {};

		for (const res of confirmed) {
			const hour = parseInt(res.time.split(':')[0]);
			if (!byHour[hour]) byHour[hour] = { reservations: 0, covers: 0 };
			byHour[hour].reservations++;
			byHour[hour].covers += res.partySize;
		}

		return {
			date,
			totalReservations: confirmed.length,
			totalCovers: confirmed.reduce((sum, r) => sum + r.partySize, 0),
			byHour: Object.entries(byHour).map(([hour, data]) => ({
				hour: parseInt(hour),
				...data,
			})),
		};
	}
}

/** Create Resy client from environment variables */
export function createResyClient(): ResyClient | null {
	const apiKey = process.env.RESY_API_KEY;
	const venueId = process.env.RESY_VENUE_ID;

	if (!apiKey || !venueId) {
		console.warn('[Resy] Missing credentials — Resy integration disabled');
		return null;
	}

	return new ResyClient({ apiKey, venueId });
}
