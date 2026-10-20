import { readFileSync } from 'node:fs';

/** Only an absent store is empty. Failed reads must never authorize replacement. */
export function readRecordStore<T>(path: string, collection: string, empty: () => T): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw error;
  }
  const store = JSON.parse(text);
  const records = store?.[collection];
  if (!store || typeof store !== 'object' || Array.isArray(store)
      || !records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`Invalid ${collection} store at ${path}; existing data was preserved`);
  }
  return store as T;
}
