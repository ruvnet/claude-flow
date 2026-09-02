/**
 * Toast POS API Client
 *
 * Handles authentication and data retrieval from Toast's REST API.
 * Docs: https://doc.toasttab.com/openapi/
 */

interface ToastConfig {
	clientId: string;
	clientSecret: string;
	apiKey: string;
	restaurantGuid: string;
	baseUrl?: string;
}

interface ToastOrder {
	guid: string;
	entityType: string;
	openedDate: string;
	closedDate?: string;
	totalAmount: number;
	numberOfGuests: number;
	server?: { guid: string; firstName: string; lastName: string };
}

interface ToastTimeEntry {
	guid: string;
	employeeGuid: string;
	jobGuid: string;
	inDate: string;
	outDate?: string;
	regularHours: number;
	overtimeHours: number;
	hourlyWage: number;
}

interface ToastLaborSummary {
	date: string;
	totalLaborCost: number;
	totalHours: number;
	overtimeHours: number;
	overtimeCost: number;
}

export interface SalesMixEntry {
	category: string;
	revenue: number;
	itemCount: number;
	pctOfTotal: number;
}

export interface PmixEntry {
	itemName: string;
	itemGuid: string | null;
	category: string;
	quantity: number;
	revenue: number;
	avgPrice: number;
}

export interface HourlySalesEntry {
	hour: number;
	revenue: number;
	covers: number;
	orderCount: number;
}

export interface DaySummary {
	totalRevenue: number;
	totalCovers: number;
	orderCount: number;
	totalDiscounts: number;
	totalComps: number;
	salesMix: SalesMixEntry[];
	pmix: PmixEntry[];
	/** Hourly sales computed in the same order-fetch pass — no extra API calls */
	hourlySales: HourlySalesEntry[];
	/** Dining metrics computed in the same order-fetch pass — no extra API calls */
	diningMetrics: DiningMetrics;
}

export interface DiningMetrics {
	avgDwellMinutes: number;
	avgTurnsPerSeat: number;
	totalOrders: number;
	avgPartySize: number;
	peakHourTurns: number;
}

export class ToastClient {
	private config: ToastConfig;
	private accessToken: string | null = null;
	private tokenExpiry: number = 0;
	private menuCategoryCache: Map<string, string> | null = null;
	/** Maps revenue center GUID -> name (fetched from config API, cached per instance) */
	private rcGuidToNameCache: Map<string, string> | null = null;

	constructor(config: ToastConfig) {
		this.config = {
			...config,
			baseUrl: config.baseUrl || 'https://ws-api.toasttab.com',
		};
	}

	private authResponse: any = null;

	/**
	 * Fetch revenue center GUID -> name mapping from Toast config API.
	 * Cached per client instance since revenue centers don't change during a sync.
	 * Toast's orders API only returns revenueCenter.guid (no name), so we need
	 * this lookup to match against human-readable filter names.
	 */
	async getRevenueCenterMap(): Promise<Map<string, string>> {
		if (this.rcGuidToNameCache) return this.rcGuidToNameCache;
		const map = new Map<string, string>();
		try {
			const data = await this.request<any[]>('/config/v2/revenueCenters');
			const centers = Array.isArray(data) ? data : [];
			for (const rc of centers) {
				if (rc.guid && rc.name) {
					map.set(rc.guid, rc.name);
				}
			}
		} catch (err) {
			console.warn('[Toast] Failed to fetch revenue centers from config API:', err);
		}
		this.rcGuidToNameCache = map;
		return map;
	}

	/**
	 * Resolve a revenue center object (from order or check) to its name.
	 * Toast orders only include { guid, entityType } — the name must be
	 * looked up from the config API cache.
	 */
	private resolveRcName(rc: any, rcMap: Map<string, string>): string {
		if (!rc) return '';
		// Prefer explicit name if present (rare in orders API, but possible)
		if (rc.name) return rc.name;
		// Look up GUID in config cache
		if (rc.guid && rcMap.has(rc.guid)) return rcMap.get(rc.guid)!;
		return '';
	}

	/**
	 * Filter an order's checks to only those whose revenueCenter.name matches
	 * the filter list (already lowercased). The revenue center can be on the
	 * check itself or inherited from the order level.
	 *
	 * Revenue center names are resolved via the config API cache since Toast's
	 * orders API only returns GUIDs without names.
	 */
	private filterChecksByRevenueCenter(order: any, rcFilterLower: string[], rcMap: Map<string, string>): any[] {
		const checks = order.checks;
		if (!checks || !Array.isArray(checks)) return [];

		// Order-level revenue center (fallback when check doesn't have one)
		const orderRcName = this.resolveRcName(order.revenueCenter, rcMap).toLowerCase();

		return checks.filter((check: any) => {
			const checkRcName = this.resolveRcName(check.revenueCenter, rcMap).toLowerCase();
			const rcName = checkRcName || orderRcName;
			if (!rcName) return false;
			return rcFilterLower.some(f => rcName === f);
		});
	}

	/** Authenticate with Toast API using client credentials */
	private async authenticate(): Promise<string> {
		if (this.accessToken && Date.now() < this.tokenExpiry) {
			return this.accessToken;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000);
		try {
			const response = await fetch(
				`${this.config.baseUrl}/authentication/v1/authentication/login`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						clientId: this.config.clientId,
						clientSecret: this.config.clientSecret,
						userAccessType: 'TOAST_MACHINE_CLIENT',
					}),
					signal: controller.signal,
				},
			);

			if (!response.ok) {
				throw new Error(`Toast auth failed: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			this.authResponse = data;
			this.accessToken = data.token?.accessToken || data.accessToken;
			this.tokenExpiry = Date.now() + 3500 * 1000; // ~1 hour
			// Extract restaurant GUID from token if available
			if (!this.config.restaurantGuid && data.token?.restaurantGuid) {
				this.config.restaurantGuid = data.token.restaurantGuid;
			}
			if (!this.config.restaurantGuid && data.restaurantGuid) {
				this.config.restaurantGuid = data.restaurantGuid;
			}
			return this.accessToken!;
		} finally {
			clearTimeout(timeout);
		}
	}

	/** Get raw auth response for debugging */
	getAuthResponse(): any {
		return this.authResponse;
	}

	/** Make authenticated request to Toast API */
	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const token = await this.authenticate();

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000);
		try {
			const response = await fetch(`${this.config.baseUrl}${path}`, {
				...options,
				headers: {
					'Authorization': `Bearer ${token}`,
					'Toast-Restaurant-External-ID': this.config.restaurantGuid,
					'Content-Type': 'application/json',
					...options.headers,
				},
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`Toast API error: ${response.status} ${response.statusText}`);
			}

			return response.json();
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Build a map of menu item GUID -> menu group name from Toast's menus API.
	 * Cached per client instance since menus don't change during a sync.
	 */
	async getMenuItemCategoryMap(): Promise<Map<string, string>> {
		if (this.menuCategoryCache) return this.menuCategoryCache;
		const map = new Map<string, string>();
		try {
			const data = await this.request<any>('/menus/v2/menus');
			const menus = Array.isArray(data) ? data : data?.menus || [];
			for (const menu of menus) {
				for (const group of menu.menuGroups || []) {
					const groupName = group.name || '';
					for (const item of group.menuItems || []) {
						if (item.guid) map.set(item.guid, groupName);
					}
				}
			}
		} catch (err) {
			console.warn('[Toast] Failed to fetch menus for category map, falling back to salesCategory', err);
		}
		this.menuCategoryCache = map;
		return map;
	}

	/** Get revenue summary for a business date (YYYY-MM-DD) — delegates to getDaySummary */
	async getRevenueSummary(businessDate: string, revenueCenterFilter?: string[]): Promise<{
		totalRevenue: number;
		totalCovers: number;
		orderCount: number;
	}> {
		const summary = await this.getDaySummary(businessDate, revenueCenterFilter);
		return {
			totalRevenue: summary.totalRevenue,
			totalCovers: summary.totalCovers,
			orderCount: summary.orderCount,
		};
	}

	/**
	 * Get full day summary: revenue, covers, sales mix, and PMIX in a single pass.
	 * Avoids fetching order details twice for revenue + sales mix.
	 *
	 * @param revenueCenterFilter - When provided, only include checks whose
	 *   revenueCenter.name matches one of these strings (case-insensitive).
	 *   Used for locations that share a single Toast GUID (e.g. Little Wing / Vessel).
	 */
	async getDaySummary(businessDate: string, revenueCenterFilter?: string[]): Promise<DaySummary> {
		const dateCompact = businessDate.replace(/-/g, '');
		const fetchList: [Promise<string[]>, Promise<Map<string, string>>, Promise<Map<string, string>>?] = [
			this.request<string[]>(`/orders/v2/orders?businessDate=${dateCompact}`),
			this.getMenuItemCategoryMap(),
		];
		// Pre-fetch RC name map when filtering is needed
		if (revenueCenterFilter && revenueCenterFilter.length > 0) {
			fetchList.push(this.getRevenueCenterMap());
		}
		const [orderGuids, menuCategoryMap, rcMap] = await Promise.all(fetchList) as [string[], Map<string, string>, Map<string, string>?];
		if (!orderGuids || orderGuids.length === 0) {
			return {
				totalRevenue: 0, totalCovers: 0, orderCount: 0, totalDiscounts: 0, totalComps: 0,
				salesMix: [], pmix: [], hourlySales: [],
				diningMetrics: { avgDwellMinutes: 0, avgTurnsPerSeat: 0, totalOrders: 0, avgPartySize: 0, peakHourTurns: 0 },
			};
		}

		// Lowercase revenue center filter for case-insensitive matching
		const rcFilterLower = revenueCenterFilter?.map(r => r.toLowerCase());

		let totalRevenue = 0;
		let totalCovers = 0;
		let totalDiscounts = 0;
		let totalComps = 0;
		let matchedOrderCount = 0;
		const categoryTotals: Record<string, { revenue: number; itemCount: number }> = {};
		const itemTotals: Record<string, { itemGuid: string | null; category: string; quantity: number; revenue: number }> = {};

		// Hourly + dining data collected in the same pass (avoids re-fetching orders)
		const hourBuckets: Record<number, { revenue: number; covers: number; orderCount: number }> = {};
		const dwellTimes: number[] = [];
		let diningGuests = 0;
		let diningOrdersWithGuests = 0;
		const hourOrderCounts: Record<number, number> = {};

		// Use larger batches (15 vs 5) and shorter delay (150ms vs 500ms) — 10x faster on high-volume days
		const BATCH_SIZE = 15;
		const BATCH_DELAY_MS = 150;
		const MAX_RETRIES = 3;

		/** Fetch a single order with retry — swallows only after all retries exhausted */
		const fetchOrderWithRetry = async (guid: string): Promise<any> => {
			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				try {
					return await this.request<any>(`/orders/v2/orders/${guid}`);
				} catch (err) {
					if (attempt < MAX_RETRIES) {
						// Exponential back-off: 300ms, 600ms
						await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
					}
				}
			}
			console.warn(`[Toast] Failed to fetch order ${guid} after ${MAX_RETRIES + 1} attempts — skipping`);
			return null;
		};

		for (let i = 0; i < orderGuids.length; i += BATCH_SIZE) {
			if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
			const batch = orderGuids.slice(i, i + BATCH_SIZE);
			const orders = await Promise.all(
				batch.map(g => fetchOrderWithRetry(g))
			);
			for (const o of orders) {
				if (!o) continue;
				// Skip only hard-deleted orders (truly removed from Toast)
				// Do NOT skip o.voided — in Toast, voided=true means items within the order
				// were voided, but check.amount is already the net figure after those voids
				if (o.deleted) continue;

				// Revenue center filtering: skip orders that don't match
				if (rcFilterLower) {
					const matchingChecks = this.filterChecksByRevenueCenter(o, rcFilterLower, rcMap || new Map());
					if (matchingChecks.length === 0) continue;
					// Replace checks with only the matching ones
					o.checks = matchingChecks;
				}

				matchedOrderCount++;
				totalCovers += o.numberOfGuests || 0;
				if (!o.checks || !Array.isArray(o.checks)) continue;
				for (const check of o.checks) {
					// Skip only hard-deleted checks; check.amount is already net of item-level voids
					if (check.deleted) continue;
					if ((check.amount || 0) <= 0) continue;
					totalRevenue += check.amount;
					// Extract discounts and comps from check-level and selection-level
					for (const disc of (check.appliedDiscounts || [])) {
						const amt = disc.discountAmount || disc.amount || 0;
						const name = (disc.name || disc.discount?.name || '').toLowerCase();
						if (amt > 0) {
							if (/comp|void|manager|guest|house|gratis/i.test(name)) totalComps += amt;
							else totalDiscounts += amt;
						}
					}
					if (!check.selections || !Array.isArray(check.selections)) continue;
					for (const sel of check.selections) {
						const itemName = sel.displayName || sel.item?.name || 'Unknown Item';
						const itemGuid = sel.item?.guid || sel.itemGuid || null;
						// Prefer menu group name from menus API, fall back to salesCategory, then item name
						const menuGroup = itemGuid ? menuCategoryMap.get(itemGuid) : undefined;
						let category = menuGroup
							? normalizeMenuGroupCategory(menuGroup)
							: classifySalesCategory(sel.salesCategory?.name || sel.salesCategory?.guid || '');
						// If still Food (default) but item name suggests wine/liquor, reclassify
						if (category === 'Food') {
							const itemCheck = classifySalesCategory(itemName);
							if (itemCheck !== 'Food') category = itemCheck;
						}
						const qty = sel.quantity || 1;
						const selRevenue = (sel.price || 0) * qty;

						// Aggregate by category
						if (!categoryTotals[category]) categoryTotals[category] = { revenue: 0, itemCount: 0 };
						categoryTotals[category].revenue += selRevenue;
						categoryTotals[category].itemCount += qty;

						// Selection-level discounts
						for (const disc of (sel.appliedDiscounts || [])) {
							const amt = disc.discountAmount || disc.amount || 0;
							const dName = (disc.name || disc.discount?.name || '').toLowerCase();
							if (amt > 0) {
								if (/comp|void|manager|guest|house|gratis/i.test(dName)) totalComps += amt;
								else totalDiscounts += amt;
							}
						}

						// Aggregate by item name
						if (!itemTotals[itemName]) {
							itemTotals[itemName] = { itemGuid, category, quantity: 0, revenue: 0 };
						}
						itemTotals[itemName].quantity += qty;
						itemTotals[itemName].revenue += selRevenue;
					}
				}

				// ── Hourly sales (same pass) ──
				const orderTimeStr = o.closedDate || o.openedDate;
				if (orderTimeStr) {
					const utcDate = new Date(orderTimeStr);
					const estHourStr = utcDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
					const hour = parseInt(estHourStr, 10);
					if (!hourBuckets[hour]) hourBuckets[hour] = { revenue: 0, covers: 0, orderCount: 0 };
					hourBuckets[hour].orderCount += 1;
					hourBuckets[hour].covers += o.numberOfGuests || 0;
					// Sum check amounts for this hour — apply same filters as main revenue computation
					for (const chk of (o.checks || [])) {
						if (chk.deleted) continue;
						if ((chk.amount || 0) <= 0) continue;
						hourBuckets[hour].revenue += chk.amount;
					}
					hourOrderCounts[hour] = (hourOrderCounts[hour] || 0) + 1;
				}

				// ── Dining metrics (same pass) ──
				if (o.openedDate && o.closedDate) {
					const opened = new Date(o.openedDate).getTime();
					const closed = new Date(o.closedDate).getTime();
					if (closed > opened) {
						const dwellMin = (closed - opened) / (1000 * 60);
						if (dwellMin >= 5 && dwellMin <= 300) dwellTimes.push(dwellMin);
					}
				}
				if (o.numberOfGuests && o.numberOfGuests > 0) {
					diningGuests += o.numberOfGuests;
					diningOrdersWithGuests++;
				}
			}
		}

		// Build sales mix with pct
		const selectionRevenue = Object.values(categoryTotals).reduce((s, c) => s + c.revenue, 0);
		const salesMix: SalesMixEntry[] = Object.entries(categoryTotals)
			.map(([category, data]) => ({
				category,
				revenue: Math.round(data.revenue * 100) / 100,
				itemCount: data.itemCount,
				pctOfTotal: selectionRevenue > 0
					? Math.round((data.revenue / selectionRevenue) * 10000) / 10000
					: 0,
			}))
			.sort((a, b) => b.revenue - a.revenue);

		// Build PMIX sorted by revenue desc
		const pmix: PmixEntry[] = Object.entries(itemTotals)
			.map(([itemName, data]) => ({
				itemName,
				itemGuid: data.itemGuid,
				category: data.category,
				quantity: data.quantity,
				revenue: Math.round(data.revenue * 100) / 100,
				avgPrice: data.quantity > 0
					? Math.round((data.revenue / data.quantity) * 100) / 100
					: 0,
			}))
			.sort((a, b) => b.revenue - a.revenue);

		// Build hourly sales from collected buckets
		const hourlySales: HourlySalesEntry[] = Object.entries(hourBuckets)
			.map(([hour, data]) => ({
				hour: parseInt(hour, 10),
				revenue: Math.round(data.revenue * 100) / 100,
				covers: data.covers,
				orderCount: data.orderCount,
			}))
			.sort((a, b) => a.hour - b.hour);

		// Build dining metrics from collected data
		const avgDwellMinutes = dwellTimes.length > 0
			? dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length : 0;
		const avgPartySize = diningOrdersWithGuests > 0 ? diningGuests / diningOrdersWithGuests : 0;
		const seatCapacity = 60;
		const avgTurnsPerSeat = seatCapacity > 0 ? diningGuests / seatCapacity : 0;
		const peakHourOrders = Math.max(0, ...Object.values(hourOrderCounts));
		const peakHourTurns = seatCapacity > 0 ? (peakHourOrders * avgPartySize) / seatCapacity : 0;
		const diningMetrics: DiningMetrics = {
			avgDwellMinutes: Math.round(avgDwellMinutes * 10) / 10,
			avgTurnsPerSeat: Math.round(avgTurnsPerSeat * 100) / 100,
			totalOrders: rcFilterLower ? matchedOrderCount : orderGuids.length,
			avgPartySize: Math.round(avgPartySize * 100) / 100,
			peakHourTurns: Math.round(peakHourTurns * 100) / 100,
		};

		return {
			totalRevenue: Math.round(totalRevenue * 100) / 100,
			totalCovers,
			orderCount: rcFilterLower ? matchedOrderCount : orderGuids.length,
			totalDiscounts: Math.round(totalDiscounts * 100) / 100,
			totalComps: Math.round(totalComps * 100) / 100,
			salesMix,
			pmix,
			hourlySales,
			diningMetrics,
		};
	}

	/**
	 * Get hourly sales breakdown for a business date.
	 * Groups orders by hour of day using closedDate (or openedDate fallback),
	 * summing revenue, covers, and order count per hour.
	 *
	 * @param revenueCenterFilter - When provided, only include orders whose
	 *   checks match one of these revenue center names (case-insensitive).
	 */
	async getHourlySales(businessDate: string, revenueCenterFilter?: string[]): Promise<HourlySalesEntry[]> {
		const dateCompact = businessDate.replace(/-/g, '');
		const orderGuids = await this.request<string[]>(
			`/orders/v2/orders?businessDate=${dateCompact}`,
		);
		if (!orderGuids || orderGuids.length === 0) return [];

		const rcFilterLower = revenueCenterFilter?.map(r => r.toLowerCase());
		// Pre-fetch RC name map when filtering is needed
		const rcMap = rcFilterLower ? await this.getRevenueCenterMap() : new Map<string, string>();
		const hourBuckets: Record<number, { revenue: number; covers: number; orderCount: number }> = {};

		for (let i = 0; i < orderGuids.length; i += 5) {
			if (i > 0) await new Promise((r) => setTimeout(r, 500));
			const batch = orderGuids.slice(i, i + 5);
			const orders = await Promise.all(
				batch.map((g) => this.request<any>(`/orders/v2/orders/${g}`).catch(() => null)),
			);
			for (const o of orders) {
				if (!o) continue;
				if (o.deleted) continue;
				// Revenue center filtering
				if (rcFilterLower) {
					const matchingChecks = this.filterChecksByRevenueCenter(o, rcFilterLower, rcMap);
					if (matchingChecks.length === 0) continue;
					o.checks = matchingChecks;
				}
				const dateStr = o.closedDate || o.openedDate;
				if (!dateStr) continue;
				// Convert UTC timestamp to EST/EDT hour
				const utcDate = new Date(dateStr);
				const estStr = utcDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
				const hour = parseInt(estStr, 10);
				if (!hourBuckets[hour]) {
					hourBuckets[hour] = { revenue: 0, covers: 0, orderCount: 0 };
				}
				hourBuckets[hour].orderCount += 1;
				hourBuckets[hour].covers += o.numberOfGuests || 0;
				if (o.checks && Array.isArray(o.checks)) {
					for (const check of o.checks) {
						if (check.deleted) continue;
						if ((check.amount || 0) <= 0) continue;
						hourBuckets[hour].revenue += check.amount;
					}
				}
			}
		}

		return Object.entries(hourBuckets)
			.map(([hour, data]) => ({
				hour: parseInt(hour, 10),
				revenue: Math.round(data.revenue * 100) / 100,
				covers: data.covers,
				orderCount: data.orderCount,
			}))
			.sort((a, b) => a.hour - b.hour);
	}

	/**
	 * Compute dining metrics: avg dwell time, table turns, party size
	 * from order open/close timestamps.
	 * Assumes ~60 seats as default capacity (can be configured per location).
	 *
	 * @param revenueCenterFilter - When provided, only include orders whose
	 *   checks match one of these revenue center names (case-insensitive).
	 */
	async getDiningMetrics(businessDate: string, seatCapacity = 60, revenueCenterFilter?: string[]): Promise<DiningMetrics> {
		const dateCompact = businessDate.replace(/-/g, '');
		const orderGuids = await this.request<string[]>(
			`/orders/v2/orders?businessDate=${dateCompact}`,
		);
		if (!orderGuids || orderGuids.length === 0) {
			return { avgDwellMinutes: 0, avgTurnsPerSeat: 0, totalOrders: 0, avgPartySize: 0, peakHourTurns: 0 };
		}

		const rcFilterLower = revenueCenterFilter?.map(r => r.toLowerCase());
		// Pre-fetch RC name map when filtering is needed
		const rcMap = rcFilterLower ? await this.getRevenueCenterMap() : new Map<string, string>();
		const dwellTimes: number[] = [];
		let totalGuests = 0;
		let ordersWithGuests = 0;
		const hourOrderCounts: Record<number, number> = {};

		for (let i = 0; i < orderGuids.length; i += 5) {
			if (i > 0) await new Promise(r => setTimeout(r, 500));
			const batch = orderGuids.slice(i, i + 5);
			const orders = await Promise.all(
				batch.map(g => this.request<any>(`/orders/v2/orders/${g}`).catch(() => null)),
			);
			for (const o of orders) {
				if (!o) continue;
				// Revenue center filtering
				if (rcFilterLower) {
					const matchingChecks = this.filterChecksByRevenueCenter(o, rcFilterLower, rcMap);
					if (matchingChecks.length === 0) continue;
				}
				// Dwell time = closedDate - openedDate
				if (o.openedDate && o.closedDate) {
					const opened = new Date(o.openedDate).getTime();
					const closed = new Date(o.closedDate).getTime();
					if (closed > opened) {
						const dwellMin = (closed - opened) / (1000 * 60);
						// Filter out unreasonable dwell times (< 5 min or > 300 min)
						if (dwellMin >= 5 && dwellMin <= 300) {
							dwellTimes.push(dwellMin);
						}
					}
				}
				if (o.numberOfGuests && o.numberOfGuests > 0) {
					totalGuests += o.numberOfGuests;
					ordersWithGuests++;
				}
				// Track orders per hour for peak calculation
				const timeStr = o.openedDate || o.closedDate;
				if (timeStr) {
					const utc = new Date(timeStr);
					const estStr = utc.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
					const hour = parseInt(estStr, 10);
					hourOrderCounts[hour] = (hourOrderCounts[hour] || 0) + 1;
				}
			}
		}

		const avgDwellMinutes = dwellTimes.length > 0
			? dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length
			: 0;
		const avgPartySize = ordersWithGuests > 0 ? totalGuests / ordersWithGuests : 0;

		// Turns per seat: total covers / seat capacity
		const avgTurnsPerSeat = seatCapacity > 0 ? totalGuests / seatCapacity : 0;

		// Peak hour turns
		const peakHourOrders = Math.max(0, ...Object.values(hourOrderCounts));
		const peakHourTurns = seatCapacity > 0 ? (peakHourOrders * avgPartySize) / seatCapacity : 0;

		return {
			avgDwellMinutes: Math.round(avgDwellMinutes * 10) / 10,
			avgTurnsPerSeat: Math.round(avgTurnsPerSeat * 100) / 100,
			totalOrders: orderGuids.length,
			avgPartySize: Math.round(avgPartySize * 100) / 100,
			peakHourTurns: Math.round(peakHourTurns * 100) / 100,
		};
	}

	/** Get time entries (labor data) for a business date (YYYY-MM-DD) */
	async getTimeEntries(startDate: string, endDate: string): Promise<ToastTimeEntry[]> {
		const dateCompact = startDate.replace(/-/g, '');
		return this.request<ToastTimeEntry[]>(
			`/labor/v1/timeEntries?businessDate=${dateCompact}`
		);
	}

	/** Get labor summary for a date */
	async getLaborSummary(businessDate: string): Promise<ToastLaborSummary> {
		const entries = await this.getTimeEntries(businessDate, businessDate);

		const totalHours = entries.reduce((sum, e) => sum + e.regularHours + e.overtimeHours, 0);
		const overtimeHours = entries.reduce((sum, e) => sum + e.overtimeHours, 0);
		const totalLaborCost = entries.reduce(
			(sum, e) => sum + e.regularHours * e.hourlyWage + e.overtimeHours * e.hourlyWage * 1.5,
			0
		);
		const overtimeCost = entries.reduce(
			(sum, e) => sum + e.overtimeHours * e.hourlyWage * 1.5,
			0
		);

		return {
			date: businessDate,
			totalLaborCost,
			totalHours,
			overtimeHours,
			overtimeCost,
		};
	}

	/** Fetch all job titles from Toast for mapping setup */
	async getJobs(): Promise<{ guid: string; title: string; defaultWage: number }[]> {
		const jobs = await this.request<any[]>('/labor/v1/jobs');
		return jobs.map((j) => ({
			guid: j.guid || j.externalId,
			title: j.title || j.name,
			defaultWage: j.defaultWage || 0,
		}));
	}

	/** Fetch time entries grouped by job for a date, returning job name + labor $ */
	async getLaborByJob(businessDate: string): Promise<
		{
			jobGuid: string;
			jobTitle: string;
			laborDollars: number;
			regularHours: number;
			overtimeHours: number;
		}[]
	> {
		const entries = await this.getTimeEntries(businessDate, businessDate);
		const jobs = await this.getJobs();
		const jobMap = new Map(jobs.map((j) => [j.guid, { title: j.title, defaultWage: j.defaultWage }]));

		const grouped: Record<
			string,
			{ laborDollars: number; regularHours: number; overtimeHours: number }
		> = {};

		for (const entry of entries as any[]) {
			// Toast uses jobReference.guid, not jobGuid
			const key = entry.jobReference?.guid || entry.jobGuid;
			if (!key) continue;
			if (!grouped[key]) {
				grouped[key] = { laborDollars: 0, regularHours: 0, overtimeHours: 0 };
			}
			const regHours = entry.regularHours || 0;
			const otHours = entry.overtimeHours || 0;
			// Use entry.hourlyWage if set, otherwise fall back to job defaultWage
			const wage = entry.hourlyWage || jobMap.get(key)?.defaultWage || 0;
			grouped[key].regularHours += regHours;
			grouped[key].overtimeHours += otHours;
			grouped[key].laborDollars += regHours * wage + otHours * wage * 1.5;
		}

		return Object.entries(grouped).map(([jobGuid, data]) => ({
			jobGuid,
			jobTitle: jobMap.get(jobGuid)?.title || 'Unknown',
			laborDollars: Math.round(data.laborDollars * 100) / 100,
			regularHours: Math.round(data.regularHours * 100) / 100,
			overtimeHours: Math.round(data.overtimeHours * 100) / 100,
		}));
	}

	/** Discover restaurants accessible with current credentials */
	async getRestaurants(): Promise<{ guid: string; name: string; address?: string }[]> {
		const token = await this.authenticate();
		// Try /config/v1/restaurantInfo first (works with Standard API credentials)
		const endpoints = [
			'/config/v1/restaurantInfo',
			'/restaurants/v1/restaurants',
		];
		for (const endpoint of endpoints) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 30000);
			try {
				const response = await fetch(
					`${this.config.baseUrl}${endpoint}`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
							'Toast-Restaurant-External-ID': this.config.restaurantGuid || '',
							'Content-Type': 'application/json',
						},
						signal: controller.signal,
					},
				);
				if (!response.ok) continue;
				const data = await response.json();
				// /config/v1/restaurantInfo returns a single restaurant object
				if (data && !Array.isArray(data) && (data.guid || data.general)) {
					const name = data.general?.name || data.name || 'Restaurant';
					const guid = data.guid || this.config.restaurantGuid || '';
					const addr = data.general?.address;
					const address = addr ? `${addr.streetAddress || ''}, ${addr.city || ''} ${addr.state || ''}`.trim() : undefined;
					return [{ guid, name, address }];
				}
				// /restaurants/v1/restaurants returns an array
				if (Array.isArray(data)) {
					return data.map((r: any) => ({
						guid: r.guid,
						name: r.general?.name || r.name || r.guid,
						address: r.general?.address ? `${r.general.address.streetAddress || ''}, ${r.general.address.city || ''}` : undefined,
					}));
				}
			} catch {
				continue;
			} finally {
				clearTimeout(timeout);
			}
		}
		return [{ guid: this.config.restaurantGuid || '', name: 'Current Restaurant' }];
	}
}

/**
 * Normalize a Toast menu group name into one of our standard categories:
 * Food, Liquor (incl. cocktails), Wine, Beer, Non-Alcoholic, Other
 */
function normalizeMenuGroupCategory(groupName: string): string {
	const lower = groupName.toLowerCase();
	// Food — broad match for meal items, plates, courses, shareables, snacks, etc.
	if (/food|entree|appetizer|dessert|salad|soup|sandwich|burger|pizza|pasta|brunch|lunch|dinner|side|plate|main|starter|course|tapas|shareable|snack|oyster|seafood|steak|chicken|fish|meat|vegetable|cheese|charcuterie|bread|fries|taco|sushi|ramen|noodle|rice|egg|breakfast|grill|roast|raw bar|bites|small plate|large plate|kids|children/i.test(lower)) return 'Food';
	// Liquor (includes cocktails and spirits)
	if (/cocktail|martini|margarita|spritz|negroni|old fashioned|manhattan|daiquiri|mojito|mixed drink|highball|sour|liquor|spirit|whiskey|bourbon|scotch|tequila|mezcal|vodka|gin|rum|brandy|cognac|amaro|cordial|digestif|aperitif|shot/i.test(lower)) return 'Liquor';
	// Wine
	if (/wine|btg|btb|champagne|prosecco|ros[eé]|sparkling|pinot|cabernet|merlot|chardonnay|sauvignon|riesling|malbec|by the glass|by the bottle/i.test(lower)) return 'Wine';
	// Beer
	if (/beer|draft|ale|lager|ipa|cider|stout|pilsner|porter|wheat|seltzer|hard seltzer|brew/i.test(lower)) return 'Beer';
	// Non-Alcoholic
	if (/\bna\b|non.?alc|soft drink|soda|juice|coffee|tea|water|mocktail|espresso|latte|cappuccino|hot choc|lemonade|kombucha|virgin|zero.?proof|still|sparkling water|arnold palmer/i.test(lower)) return 'Non-Alcoholic';
	// Merchandise / Retail (gift cards, merch, etc.) — keep as Other
	if (/merch|retail|gift.?card|swag|merchandise|delivery fee|service charge|gratuity|tip/i.test(lower)) return 'Other';
	// Event/banquet revenue — classify as Food (F&B minimum, prix fixe, event pricing)
	if (/event|prix.?fixe|tasting|banquet|minimum|supplement|package|per.?person/i.test(lower)) return 'Food';
	// Default: assume Food for restaurants (most unrecognized menu groups are food items)
	return 'Food';
}

/** Fallback: classify from salesCategory name when menu lookup misses. */
function classifySalesCategory(raw: string): string {
	const l = (raw || '').toLowerCase();
	if (!l || l === 'undefined') return 'Food';
	if (/food|entree|appetizer|dessert|salad|soup|sandwich|burger|pizza|pasta|brunch|lunch|dinner|side|plate|main|starter|course|tapas|shareable|snack|oyster|seafood|steak|chicken|fish|meat|vegetable|cheese|charcuterie|bread|fries|taco|sushi|ramen|noodle|rice|egg|breakfast|grill|roast|raw bar|bites|small plate|large plate|kids|children|tart|pie|cake|mousse|creme|sorbet|butterscotch|hand pie/.test(l)) return 'Food';
	if (/cocktail|martini|margarita|spritz|negroni|old fashioned|manhattan|daiquiri|mojito|mixed drink|highball|sour|liquor|spirit|whiskey|bourbon|scotch|tequila|mezcal|vodka|gin|rum|brandy|cognac|amaro|cordial|digestif|aperitif|shot|titos|woodford|bulleit|hendrick|makers mark|jack daniel|jameson|patron|grey goose|ketel one|tanqueray|bombay/.test(l)) return 'Liquor';
	if (/beer|draft|ale|lager|ipa|cider|stout|pilsner|porter|wheat|seltzer|hard seltzer|brew/.test(l)) return 'Beer';
	if (/wine|champagne|prosecco|ros[eé]|sparkling|pinot|cabernet|merlot|chardonnay|sauvignon|riesling|malbec|by the glass|by the bottle|hermitage|btl|domaine|chateau|reserve|cuvee|brut|blanc|rouge|nero|barolo|chianti|gattinara|cain|lopez|tondonia|roumier|peters|jobard|servin|bereche|cantina|fay/.test(l)) return 'Wine';
	if (/non.?alc|soft drink|soda|juice|coffee|tea|water|n\/a|mocktail|espresso|latte|cappuccino|lemonade|kombucha|virgin|zero.?proof/.test(l)) return 'Non-Alcoholic';
	if (/gift.?card|merch|service charge|gratuity/.test(l)) return 'Other';
	if (/event|prix.?fixe|minimum|supplement|per.?person/.test(l)) return 'Food';
	return 'Food';
}

/** Create Toast client from environment variables */
export function createToastClient(): ToastClient | null {
	const clientId = process.env.TOAST_CLIENT_ID;
	const clientSecret = process.env.TOAST_CLIENT_SECRET;
	const apiKey = process.env.TOAST_API_KEY;
	const restaurantGuid = process.env.TOAST_RESTAURANT_GUID;

	if (!clientId || !clientSecret || !restaurantGuid) {
		console.warn('[Toast] Missing credentials — Toast integration disabled');
		return null;
	}

	return new ToastClient({
		clientId,
		clientSecret,
		apiKey: apiKey || '',
		restaurantGuid,
	});
}

/** Create Toast client from explicit credentials (for per-location configs stored in Supabase) */
export function createToastClientFromCredentials(config: {
	clientId: string;
	clientSecret: string;
	restaurantGuid: string;
}): ToastClient {
	return new ToastClient({
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		apiKey: '',
		restaurantGuid: config.restaurantGuid,
	});
}
