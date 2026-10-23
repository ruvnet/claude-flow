/**
 * RVF Document Store — self-contained, zero-dependency database for RuVocal.
 *
 * Replaces MongoDB with an in-memory document store persisted to a single
 * RVF JSON file on disk. Implements the MongoDB Collection interface used
 * by HF Chat UI so all 56 importing files work unchanged.
 *
 * Storage format:
 * {
 *   rvf_version: "2.0",
 *   collections: { "conversations": { "id1": {...}, ... }, ... },
 *   metadata: { created_at, updated_at, doc_count }
 * }
 */

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { Readable, Writable } from "stream";

// ---------------------------------------------------------------------------
// ObjectId compatibility
// ---------------------------------------------------------------------------

export class ObjectId {
	private _id: string;
	constructor(id?: string) {
		this._id = id ?? randomUUID();
	}
	toString() {
		return this._id;
	}
	toHexString() {
		return this._id;
	}
	equals(other: ObjectId | string) {
		const otherStr = typeof other === "string" ? other : other.toString();
		return this._id === otherStr;
	}
	toJSON() {
		return this._id;
	}
	static createFromHexString(hex: string) {
		return new ObjectId(hex);
	}
}

// Type aliases for MongoDB compatibility
export type WithId<T> = T & { _id: string | ObjectId };
export type AnyBulkWriteOperation<T> = Record<string, unknown>;
export type FindCursor<T> = RvfCursor<T>;
export type Collection<T> = RvfCollection<T>;

// ---------------------------------------------------------------------------
// RVF persistence
// ---------------------------------------------------------------------------

interface RvfFile {
	rvf_version: string;
	format: string;
	collections: Record<string, Record<string, unknown>>;
	tenants?: Record<string, Record<string, Record<string, unknown>>>;
	metadata: {
		created_at: string;
		updated_at: string;
		doc_count: number;
		multi_tenant?: boolean;
	};
}

let _store: Map<string, Map<string, Record<string, unknown>>> = new Map();
let _dbPath: string = "";
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

// Multi-tenant: per-tenant stores keyed by tenantId
let _tenantStores: Map<string, Map<string, Map<string, Record<string, unknown>>>> = new Map();
let _multiTenantEnabled = false;

export function enableMultiTenant(enabled = true): void {
	_multiTenantEnabled = enabled;
}

export function isMultiTenant(): boolean {
	return _multiTenantEnabled;
}

function getTenantStore(tenantId: string): Map<string, Map<string, Record<string, unknown>>> {
	if (!_tenantStores.has(tenantId)) {
		_tenantStores.set(tenantId, new Map());
	}
	return _tenantStores.get(tenantId)!;
}

export function listTenants(): string[] {
	return [..._tenantStores.keys()];
}

export function getTenantStats(): Record<string, { collections: number; documents: number }> {
	const stats: Record<string, { collections: number; documents: number }> = {};
	for (const [tenantId, store] of _tenantStores) {
		let docCount = 0;
		for (const coll of store.values()) docCount += coll.size;
		stats[tenantId] = { collections: store.size, documents: docCount };
	}
	return stats;
}

export function initRvfStore(dbPath: string): void {
	_dbPath = dbPath;

	if (existsSync(dbPath)) {
		try {
			const raw = readFileSync(dbPath, "utf-8");
			const data: RvfFile = JSON.parse(raw);
			for (const [name, docs] of Object.entries(data.collections)) {
				const map = new Map<string, Record<string, unknown>>();
				for (const [id, doc] of Object.entries(docs)) {
					map.set(id, doc as Record<string, unknown>);
				}
				_store.set(name, map);
			}
			// Load tenant data if present
			if (data.tenants) {
				_multiTenantEnabled = true;
				for (const [tenantId, collections] of Object.entries(data.tenants)) {
					const tenantStore = new Map<string, Map<string, Record<string, unknown>>>();
					for (const [name, docs] of Object.entries(collections)) {
						const map = new Map<string, Record<string, unknown>>();
						for (const [id, doc] of Object.entries(docs)) {
							map.set(id, doc as Record<string, unknown>);
						}
						tenantStore.set(name, map);
					}
					_tenantStores.set(tenantId, tenantStore);
				}
			}
			console.log(
				`[RVF] Loaded ${Object.keys(data.collections).length} collections from ${dbPath}` +
				(_tenantStores.size > 0 ? ` (${_tenantStores.size} tenants)` : "")
			);
		} catch (err) {
			console.error(`[RVF] Error loading ${dbPath}, starting fresh:`, err);
			_store = new Map();
		}
	} else {
		console.log(`[RVF] No existing database at ${dbPath}, starting fresh`);
	}
}

function scheduleSave(): void {
	if (_saveTimer) clearTimeout(_saveTimer);
	_saveTimer = setTimeout(() => flushToDisk(), SAVE_DEBOUNCE_MS);
}

export function flushToDisk(): void {
	if (!_dbPath) return;

	const dir = dirname(_dbPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	let docCount = 0;
	const collections: Record<string, Record<string, unknown>> = {};
	for (const [name, docs] of _store) {
		const obj: Record<string, unknown> = {};
		for (const [id, doc] of docs) {
			obj[id] = doc;
			docCount++;
		}
		collections[name] = obj;
	}

	// Serialize tenant stores
	const tenants: Record<string, Record<string, Record<string, unknown>>> = {};
	let tenantDocCount = 0;
	if (_multiTenantEnabled) {
		for (const [tenantId, tenantStore] of _tenantStores) {
			const tenantColls: Record<string, Record<string, unknown>> = {};
			for (const [name, docs] of tenantStore) {
				const obj: Record<string, unknown> = {};
				for (const [id, doc] of docs) {
					obj[id] = doc;
					tenantDocCount++;
				}
				tenantColls[name] = obj;
			}
			tenants[tenantId] = tenantColls;
		}
	}

	const rvf: RvfFile = {
		rvf_version: "2.0",
		format: "rvf-database",
		collections,
		...(Object.keys(tenants).length > 0 ? { tenants } : {}),
		metadata: {
			created_at: collections["_meta"]
				? String((collections["_meta"] as Record<string, unknown>)?.created_at ?? new Date().toISOString())
				: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			doc_count: docCount + tenantDocCount,
			...(_multiTenantEnabled ? { multi_tenant: true } : {}),
		},
	};

	writeFileSync(_dbPath, JSON.stringify(rvf), "utf-8");
}

function getCollection(name: string, tenantId?: string): Map<string, Record<string, unknown>> {
	if (tenantId) {
		const tenantStore = getTenantStore(tenantId);
		if (!tenantStore.has(name)) tenantStore.set(name, new Map());
		return tenantStore.get(name)!;
	}
	if (!_store.has(name)) _store.set(name, new Map());
	return _store.get(name)!;
}

// ---------------------------------------------------------------------------
// Filter matching (MongoDB-compatible)
// ---------------------------------------------------------------------------

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
	for (const [key, val] of Object.entries(filter)) {
		if (key === "$or" && Array.isArray(val)) {
			if (!val.some((sub) => matchesFilter(doc, sub as Record<string, unknown>))) return false;
			continue;
		}
		if (key === "$and" && Array.isArray(val)) {
			if (!val.every((sub) => matchesFilter(doc, sub as Record<string, unknown>))) return false;
			continue;
		}

		const docVal = getNestedValue(doc, key);

		if (val === null || val === undefined) {
			if (docVal !== null && docVal !== undefined) return false;
			continue;
		}

		if (val instanceof ObjectId) {
			if (String(docVal) !== val.toString()) return false;
			continue;
		}

		// Detect foreign ObjectId-like objects (e.g. mongodb's ObjectId) that are NOT
		// query operators.  These have a toString()/toHexString() but zero own
		// enumerable entries, so Object.entries() returns [].  Without this guard,
		// such values silently pass the operator loop below, matching ALL documents.
		if (
			typeof val === "object" &&
			val !== null &&
			!Array.isArray(val) &&
			!(val instanceof Date) &&
			typeof (val as Record<string, unknown>).toHexString === "function"
		) {
			if (String(docVal) !== String(val)) return false;
			continue;
		}

		if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
			const ops = val as Record<string, unknown>;
			for (const [op, opVal] of Object.entries(ops)) {
				switch (op) {
					case "$exists":
						if (opVal && (docVal === undefined || docVal === null)) return false;
						if (!opVal && docVal !== undefined && docVal !== null) return false;
						break;
					case "$gt":
						if (!((docVal as number) > (opVal as number))) return false;
						break;
					case "$gte":
						if (!((docVal as number) >= (opVal as number))) return false;
						break;
					case "$lt":
						if (!((docVal as number) < (opVal as number))) return false;
						break;
					case "$lte":
						if (!((docVal as number) <= (opVal as number))) return false;
						break;
					case "$ne":
						if (docVal === opVal) return false;
						break;
					case "$in":
						if (!Array.isArray(opVal) || !opVal.some((v) => matches(docVal, v)))
							return false;
						break;
					case "$nin":
						if (Array.isArray(opVal) && opVal.some((v) => matches(docVal, v)))
							return false;
						break;
					case "$not": {
						// $not inverts the inner expression
						const innerFilter = { [key]: opVal } as Record<string, unknown>;
						if (matchesFilter(doc, innerFilter)) return false;
						break;
					}
					case "$regex": {
						const flags = ops.$options === "i" ? "i" : "";
						if (!new RegExp(String(opVal), flags).test(String(docVal ?? "")))
							return false;
						break;
					}
					case "$options":
						break; // handled by $regex
					default:
						break;
				}
			}
			continue;
		}

		if (!matches(docVal, val)) return false;
	}
	return true;
}

function isObjectIdLike(v: unknown): v is { toString(): string } {
	return (
		v instanceof ObjectId ||
		(typeof v === "object" &&
			v !== null &&
			typeof (v as Record<string, unknown>).toHexString === "function")
	);
}

function matches(a: unknown, b: unknown): boolean {
	if (isObjectIdLike(a)) return a.toString() === String(b);
	if (isObjectIdLike(b)) return String(a) === b.toString();
	return String(a) === String(b);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		if (typeof current === "object" && !Array.isArray(current)) {
			current = (current as Record<string, unknown>)[part];
		} else if (Array.isArray(current)) {
			const idx = parseInt(part, 10);
			if (!isNaN(idx)) {
				current = current[idx];
			} else {
				// Array field access — check any element
				return current.some(
					(item) =>
						typeof item === "object" &&
						item !== null &&
						getNestedValue(item as Record<string, unknown>, part) !== undefined
				);
			}
		} else {
			return undefined;
		}
	}
	return current;
}

// ---------------------------------------------------------------------------
// Apply MongoDB update operators
// ---------------------------------------------------------------------------

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
	const hasOperators = Object.keys(update).some((k) => k.startsWith("$"));

	if (!hasOperators) {
		// Replace-style update (but keep _id)
		const id = doc._id;
		for (const key of Object.keys(doc)) {
			if (key !== "_id") delete doc[key];
		}
		Object.assign(doc, update, { _id: id });
		doc.updatedAt = new Date();
		return;
	}

	if (update.$set) {
		for (const [key, val] of Object.entries(update.$set as Record<string, unknown>)) {
			setNestedValue(doc, key, val);
		}
	}

	if (update.$unset) {
		for (const key of Object.keys(update.$unset as Record<string, unknown>)) {
			deleteNestedValue(doc, key);
		}
	}

	if (update.$inc) {
		for (const [key, val] of Object.entries(update.$inc as Record<string, number>)) {
			const current = (getNestedValue(doc, key) as number) ?? 0;
			setNestedValue(doc, key, current + val);
		}
	}

	if (update.$push) {
		for (const [key, val] of Object.entries(update.$push as Record<string, unknown>)) {
			const arr = (getNestedValue(doc, key) as unknown[]) ?? [];
			if (typeof val === "object" && val !== null && "$each" in (val as Record<string, unknown>)) {
				arr.push(...((val as Record<string, unknown>).$each as unknown[]));
			} else {
				arr.push(val);
			}
			setNestedValue(doc, key, arr);
		}
	}

	if (update.$pull) {
		for (const [key, val] of Object.entries(update.$pull as Record<string, unknown>)) {
			const arr = (getNestedValue(doc, key) as unknown[]) ?? [];
			setNestedValue(
				doc,
				key,
				arr.filter((item) => !matches(item, val))
			);
		}
	}

	if (update.$addToSet) {
		for (const [key, val] of Object.entries(update.$addToSet as Record<string, unknown>)) {
			const arr = (getNestedValue(doc, key) as unknown[]) ?? [];
			if (!arr.some((item) => matches(item, val))) {
				arr.push(val);
			}
			setNestedValue(doc, key, arr);
		}
	}

	doc.updatedAt = new Date();
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(".");
	let current = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
			current[parts[i]] = {};
		}
		current = current[parts[i]] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
	const parts = path.split(".");
	let current = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		if (!(parts[i] in current)) return;
		current = current[parts[i]] as Record<string, unknown>;
	}
	delete current[parts[parts.length - 1]];
}

// ---------------------------------------------------------------------------
// Sort helper
// ---------------------------------------------------------------------------

function sortDocs(
	docs: Record<string, unknown>[],
	spec: Record<string, 1 | -1>
): Record<string, unknown>[] {
	return docs.sort((a, b) => {
		for (const [key, dir] of Object.entries(spec)) {
			const va = getNestedValue(a, key);
			const vb = getNestedValue(b, key);
			if (va === vb) continue;
			if (va === undefined || va === null) return dir;
			if (vb === undefined || vb === null) return -dir;
			if (va < vb) return -dir;
			if (va > vb) return dir;
		}
		return 0;
	});
}

// ---------------------------------------------------------------------------
// RvfCollection — MongoDB Collection interface
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RvfCollection<T = any> {
	private _tenantId?: string;

	constructor(public readonly collectionName: string, tenantId?: string) {
		this._tenantId = tenantId;
	}

	/** Create a tenant-scoped view of this collection */
	forTenant(tenantId: string): RvfCollection<T> {
		return new RvfCollection<T>(this.collectionName, tenantId);
	}

	get tenantId(): string | undefined {
		return this._tenantId;
	}

	private get docs() {
		return getCollection(this.collectionName, this._tenantId);
	}

	async findOne(
		filter: Record<string, unknown> = {},
		options?: { sort?: Record<string, 1 | -1>; projection?: Record<string, 0 | 1> }
	): Promise<T | null> {
		let results: Record<string, unknown>[] = [];
		for (const doc of this.docs.values()) {
			if (matchesFilter(doc, filter)) results.push({ ...doc });
		}
		if (options?.sort && results.length > 1) {
			results = sortDocs(results, options.sort);
		}
		return (results[0] as T) ?? null;
	}

	find(
		filter: Record<string, unknown> = {},
		options?: { projection?: Record<string, 0 | 1> }
	): RvfCursor<T> {
		return new RvfCursor<T>(this.collectionName, filter, this._tenantId);
	}

	async insertOne(
		doc: Partial<T> & Record<string, unknown>
	): Promise<{ insertedId: ObjectId; acknowledged: boolean }> {
		const id =
			doc._id != null
				? String(doc._id instanceof ObjectId ? doc._id.toString() : doc._id)
				: randomUUID();

		const record: Record<string, unknown> = {
			...doc,
			_id: id,
			createdAt: doc.createdAt ?? new Date(),
			updatedAt: doc.updatedAt ?? new Date(),
		};

		this.docs.set(id, record);
		scheduleSave();
		return { insertedId: new ObjectId(id), acknowledged: true };
	}

	async insertMany(
		docs: Array<Partial<T> & Record<string, unknown>>
	): Promise<{ insertedIds: ObjectId[]; acknowledged: boolean }> {
		const ids: ObjectId[] = [];
		for (const doc of docs) {
			const result = await this.insertOne(doc);
			ids.push(result.insertedId);
		}
		return { insertedIds: ids, acknowledged: true };
	}

	async updateOne(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: { upsert?: boolean }
	): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount?: number; acknowledged: boolean }> {
		// Collect all matching docs to detect duplicates
		const matches: Array<{ id: string; doc: Record<string, unknown> }> = [];
		for (const [id, doc] of this.docs) {
			if (matchesFilter(doc, filter)) {
				matches.push({ id, doc });
			}
		}

		// Deduplicate: if multiple docs match, keep only the newest and delete the rest
		if (matches.length > 1) {
			matches.sort((a, b) => {
				const ta = a.doc.updatedAt instanceof Date ? a.doc.updatedAt.getTime()
					: typeof a.doc.updatedAt === "string" ? new Date(a.doc.updatedAt).getTime() : 0;
				const tb = b.doc.updatedAt instanceof Date ? b.doc.updatedAt.getTime()
					: typeof b.doc.updatedAt === "string" ? new Date(b.doc.updatedAt).getTime() : 0;
				return tb - ta;
			});
			for (let i = 1; i < matches.length; i++) {
				this.docs.delete(matches[i].id);
			}
		}

		if (matches.length > 0) {
			const { id, doc } = matches[0];
			applyUpdate(doc, update);
			this.docs.set(id, doc);
			scheduleSave();
			return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
		}

		if (options?.upsert) {
			// Strip query operators from filter before using as doc fields
			const cleanFilter: Record<string, unknown> = {};
			for (const [key, val] of Object.entries(filter)) {
				if (key.startsWith("$")) continue; // skip top-level operators like $or, $and
				if (val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
					const hasOps = Object.keys(val as Record<string, unknown>).some((k) => k.startsWith("$"));
					if (hasOps) continue; // skip fields with query operators like { $exists: false }
				}
				// Stringify ObjectId-like values for consistent storage
				cleanFilter[key] = isObjectIdLike(val) ? String(val) : val;
			}
			const newDoc: Record<string, unknown> = {
				...cleanFilter,
				...((update.$set as Record<string, unknown>) ?? {}),
				...((update.$setOnInsert as Record<string, unknown>) ?? {}),
			};
			await this.insertOne(newDoc as Partial<T> & Record<string, unknown>);
			return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, acknowledged: true };
		}

		return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
	}

	async updateMany(
		filter: Record<string, unknown>,
		update: Record<string, unknown>
	): Promise<{ matchedCount: number; modifiedCount: number; acknowledged: boolean }> {
		let count = 0;
		for (const [id, doc] of this.docs) {
			if (matchesFilter(doc, filter)) {
				applyUpdate(doc, update);
				this.docs.set(id, doc);
				count++;
			}
		}
		if (count > 0) scheduleSave();
		return { matchedCount: count, modifiedCount: count, acknowledged: true };
	}

	async deleteOne(
		filter: Record<string, unknown>
	): Promise<{ deletedCount: number; acknowledged: boolean }> {
		for (const [id, doc] of this.docs) {
			if (matchesFilter(doc, filter)) {
				this.docs.delete(id);
				scheduleSave();
				return { deletedCount: 1, acknowledged: true };
			}
		}
		return { deletedCount: 0, acknowledged: true };
	}

	async deleteMany(
		filter: Record<string, unknown>
	): Promise<{ deletedCount: number; acknowledged: boolean }> {
		let count = 0;
		for (const [id, doc] of this.docs) {
			if (matchesFilter(doc, filter)) {
				this.docs.delete(id);
				count++;
			}
		}
		if (count > 0) scheduleSave();
		return { deletedCount: count, acknowledged: true };
	}

	async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
		let count = 0;
		for (const doc of this.docs.values()) {
			if (matchesFilter(doc, filter)) count++;
		}
		return count;
	}

	async distinct(field: string, filter: Record<string, unknown> = {}): Promise<unknown[]> {
		const values = new Set<unknown>();
		for (const doc of this.docs.values()) {
			if (matchesFilter(doc, filter)) {
				const val = getNestedValue(doc, field);
				if (val !== undefined) values.add(val);
			}
		}
		return [...values];
	}

	aggregate(
		pipeline: Record<string, unknown>[],
		_options?: Record<string, unknown>
	): { next: () => Promise<T | null>; toArray: () => Promise<T[]> } {
		const self = this;
		let _results: T[] | null = null;
		let _idx = 0;

		const getResults = async (): Promise<T[]> => {
			if (_results !== null) return _results;
			_results = await self._aggregateInternal(pipeline);
			return _results;
		};

		return {
			async next(): Promise<T | null> {
				const results = await getResults();
				return _idx < results.length ? results[_idx++] : null;
			},
			async toArray(): Promise<T[]> {
				return getResults();
			},
		};
	}

	private async _aggregateInternal(pipeline: Record<string, unknown>[]): Promise<T[]> {
		// Basic aggregation: handle $match + $sort + $limit
		let results = [...this.docs.values()];

		for (const stage of pipeline) {
			if (stage.$match) {
				results = results.filter((doc) =>
					matchesFilter(doc, stage.$match as Record<string, unknown>)
				);
			}
			if (stage.$sort) {
				results = sortDocs(results, stage.$sort as Record<string, 1 | -1>);
			}
			if (stage.$limit) {
				results = results.slice(0, stage.$limit as number);
			}
			if (stage.$skip) {
				results = results.slice(stage.$skip as number);
			}
			if (stage.$project) {
				const proj = stage.$project as Record<string, 0 | 1>;
				const include = Object.entries(proj).filter(([, v]) => v === 1);
				const exclude = Object.entries(proj).filter(([, v]) => v === 0);
				if (include.length > 0) {
					results = results.map((doc) => {
						const out: Record<string, unknown> = { _id: doc._id };
						for (const [key] of include) {
							out[key] = getNestedValue(doc, key);
						}
						return out;
					});
				} else if (exclude.length > 0) {
					results = results.map((doc) => {
						const out = { ...doc };
						for (const [key] of exclude) {
							delete out[key];
						}
						return out;
					});
				}
			}
			if (stage.$group) {
				const group = stage.$group as Record<string, unknown>;
				const groupId = group._id as string | null;
				const groups = new Map<string, Record<string, unknown>[]>();

				for (const doc of results) {
					const key = groupId ? String(getNestedValue(doc, groupId.replace("$", ""))) : "__all__";
					if (!groups.has(key)) groups.set(key, []);
					groups.get(key)!.push(doc);
				}

				results = [];
				for (const [key, docs] of groups) {
					const out: Record<string, unknown> = { _id: key === "__all__" ? null : key };
					for (const [field, expr] of Object.entries(group)) {
						if (field === "_id") continue;
						if (typeof expr === "object" && expr !== null) {
							const op = expr as Record<string, unknown>;
							if (op.$sum !== undefined) {
								if (typeof op.$sum === "number") {
									out[field] = docs.length * op.$sum;
								} else {
									out[field] = docs.reduce(
										(acc, d) =>
											acc + ((getNestedValue(d, String(op.$sum).replace("$", "")) as number) ?? 0),
										0
									);
								}
							}
							if (op.$count) {
								out[field] = docs.length;
							}
						}
					}
					results.push(out);
				}
			}
		}
		return results as T[];
	}

	async createIndex(
		_spec: Record<string, unknown>,
		_options?: Record<string, unknown>
	): Promise<void> {
		// No-op — in-memory store doesn't need indexes
	}

	listIndexes() {
		// Return a cursor-like object with toArray()
		// Always return 3+ items so stats computation doesn't skip
		return {
			toArray: async () => [
				{ key: { _id: 1 }, name: "_id_" },
				{ key: { key: 1 }, name: "key_1" },
				{ key: { createdAt: 1 }, name: "createdAt_1" },
			],
		};
	}

	async bulkWrite(
		ops: Array<Record<string, unknown>>,
		_options?: Record<string, unknown>
	): Promise<{ matchedCount: number; modifiedCount: number; insertedCount: number }> {
		let matchedCount = 0;
		let modifiedCount = 0;
		let insertedCount = 0;
		for (const op of ops) {
			if (op.updateOne) {
				const { filter, update } = op.updateOne as {
					filter: Record<string, unknown>;
					update: Record<string, unknown>;
				};
				const result = await this.updateOne(filter, update);
				matchedCount += result.matchedCount;
				modifiedCount += result.modifiedCount;
			} else if (op.insertOne) {
				const { document } = op.insertOne as { document: Partial<T> & Record<string, unknown> };
				await this.insertOne(document);
				insertedCount++;
			} else if (op.deleteOne) {
				const { filter } = op.deleteOne as { filter: Record<string, unknown> };
				await this.deleteOne(filter);
			}
		}
		return { matchedCount, modifiedCount, insertedCount };
	}

	async findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: { upsert?: boolean; returnDocument?: "before" | "after" }
	): Promise<{ value: T | null }> {
		// Deduplicate: if multiple docs match the filter, keep only the newest
		// and remove the rest. This prevents duplicate settings entries.
		const allMatching: Array<{ id: string; doc: Record<string, unknown> }> = [];
		for (const [id, doc] of this.docs) {
			if (matchesFilter(doc, filter)) {
				allMatching.push({ id, doc });
			}
		}
		if (allMatching.length > 1) {
			// Sort by updatedAt desc, keep the newest — handle both Date objects and ISO strings
			allMatching.sort((a, b) => {
				const ta = a.doc.updatedAt instanceof Date ? a.doc.updatedAt.getTime()
					: typeof a.doc.updatedAt === "string" ? new Date(a.doc.updatedAt).getTime() : 0;
				const tb = b.doc.updatedAt instanceof Date ? b.doc.updatedAt.getTime()
					: typeof b.doc.updatedAt === "string" ? new Date(b.doc.updatedAt).getTime() : 0;
				return tb - ta;
			});
			for (let i = 1; i < allMatching.length; i++) {
				this.docs.delete(allMatching[i].id);
			}
			scheduleSave();
		}

		const existing = allMatching.length > 0 ? ({ ...allMatching[0].doc } as T) : null;

		if (!existing && options?.upsert) {
			// Strip query operators from filter before using as doc fields
			const cleanFilter: Record<string, unknown> = {};
			for (const [key, val] of Object.entries(filter)) {
				if (key.startsWith("$")) continue;
				if (val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
					const hasOps = Object.keys(val as Record<string, unknown>).some((k) => k.startsWith("$"));
					if (hasOps) continue;
				}
				cleanFilter[key] = isObjectIdLike(val) ? String(val) : val;
			}
			const newDoc = {
				...cleanFilter,
				...((update.$set as Record<string, unknown>) ?? {}),
			};
			await this.insertOne(newDoc as Partial<T> & Record<string, unknown>);
			return { value: await this.findOne(filter) };
		}

		if (existing) {
			await this.updateOne(filter, update);
			if (options?.returnDocument === "before") {
				return { value: existing };
			}
			return { value: await this.findOne(filter) };
		}

		return { value: null };
	}

	async findOneAndDelete(
		filter: Record<string, unknown>
	): Promise<{ value: T | null }> {
		const doc = await this.findOne(filter);
		if (doc) await this.deleteOne(filter);
		return { value: doc };
	}
}

// ---------------------------------------------------------------------------
// Cursor — MongoDB-like chaining
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RvfCursor<T = any> {
	_sort: Record<string, 1 | -1> = {};
	_limit?: number;
	_skip?: number;
	_mapFn?: (doc: unknown) => unknown;
	private _cachedResults: T[] | null = null;
	private _cursorIdx = 0;

	private _tenantId?: string;

	constructor(
		public collectionName: string,
		public filter: Record<string, unknown>,
		tenantId?: string
	) {
		this._tenantId = tenantId;
	}

	sort(spec: Record<string, 1 | -1>): this {
		this._sort = { ...this._sort, ...spec };
		return this;
	}

	limit(n: number): this {
		this._limit = n;
		return this;
	}

	skip(n: number): this {
		this._skip = n;
		return this;
	}

	project<U = T>(_spec: Record<string, 0 | 1>): RvfCursor<U> {
		// Projection not strictly needed for in-memory
		return this as unknown as RvfCursor<U>;
	}

	batchSize(_n: number): this {
		return this;
	}

	map<U>(fn: (doc: T) => U): RvfCursor<U> {
		const mapped = new RvfCursor<U>(this.collectionName, this.filter, this._tenantId);
		mapped._mapFn = fn as unknown as (doc: unknown) => unknown;
		mapped._sort = { ...this._sort };
		mapped._limit = this._limit;
		mapped._skip = this._skip;
		return mapped;
	}

	async toArray(): Promise<T[]> {
		const coll = getCollection(this.collectionName, this._tenantId);
		let results: Record<string, unknown>[] = [];

		for (const doc of coll.values()) {
			if (matchesFilter(doc, this.filter)) {
				results.push({ ...doc });
			}
		}

		if (Object.keys(this._sort).length > 0) {
			results = sortDocs(results, this._sort);
		}

		if (this._skip) {
			results = results.slice(this._skip);
		}

		if (this._limit !== undefined) {
			results = results.slice(0, this._limit);
		}

		let mapped: unknown[] = results;
		if (this._mapFn) {
			mapped = results.map(this._mapFn);
		}
		return mapped as T[];
	}

	private async _ensureCached(): Promise<T[]> {
		if (this._cachedResults === null) {
			this._cachedResults = await this.toArray();
		}
		return this._cachedResults;
	}

	async hasNext(): Promise<boolean> {
		const results = await this._ensureCached();
		return this._cursorIdx < results.length;
	}

	async next(): Promise<T | null> {
		const results = await this._ensureCached();
		return this._cursorIdx < results.length ? results[this._cursorIdx++] : null;
	}

	async tryNext(): Promise<T | null> {
		return this.next();
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<T> {
		const rows = await this.toArray();
		for (const row of rows) {
			yield row;
		}
	}
}

// ---------------------------------------------------------------------------
// GridFS replacement — stores files in-memory + RVF
// ---------------------------------------------------------------------------

export class RvfGridFSBucket {
	private get files() {
		return getCollection("_files");
	}

	openUploadStream(
		filename: string,
		options?: { metadata?: Record<string, unknown>; contentType?: string }
	) {
		const id = randomUUID();
		const chunks: Buffer[] = [];
		const files = this.files;

		// objectMode so callers may pass ArrayBuffer/Uint8Array/Buffer/string
		// (uploadFile.ts hands us an ArrayBuffer cast to Buffer).
		const stream = new Writable({
			objectMode: true,
			write(chunk, _enc, cb) {
				try {
					chunks.push(
						typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as ArrayBufferLike)
					);
					cb();
				} catch (e) {
					cb(e as Error);
				}
			},
			final(cb) {
				try {
					const data = Buffer.concat(chunks).toString("base64");
					files.set(id, {
						_id: id,
						filename,
						contentType: options?.contentType ?? "application/octet-stream",
						length: data.length,
						data,
						metadata: options?.metadata ?? {},
						createdAt: new Date(),
					});
					scheduleSave();
					cb();
				} catch (e) {
					cb(e as Error);
				}
			},
		});
		(stream as unknown as { id: ObjectId }).id = new ObjectId(id);
		return stream;
	}

	openDownloadStream(id: ObjectId | string) {
		const fileId = typeof id === "string" ? id : id.toString();
		const file = this.files.get(fileId);
		if (!file) {
			// Match MongoDB GridFS (and the prior shim): a missing file is an
			// error. Surface it on the stream so callers see it via either
			// .on("error") or a rejected .toArray(), rather than silently
			// yielding zero bytes.
			const missing = new Readable({ read() {} });
			missing.destroy(new Error("File not found"));
			return missing;
		}
		return Readable.from([Buffer.from(file.data as string, "base64")]);
	}

	async delete(id: ObjectId | string) {
		const fileId = typeof id === "string" ? id : id.toString();
		this.files.delete(fileId);
		scheduleSave();
	}

	find(filter: Record<string, unknown> = {}) {
		const results: Record<string, unknown>[] = [];
		for (const doc of this.files.values()) {
			if (matchesFilter(doc, filter)) {
				const { data, ...meta } = doc;
				results.push(meta);
			}
		}
		let i = 0;
		return {
			next: async () => (i < results.length ? results[i++] : null),
			toArray: async () => results,
		};
	}
}
