import BetterSqlite3 from 'better-sqlite3';

const dbPath = '.swarm/memory.db';
const db = new BetterSqlite3(dbPath);
db.pragma('journal_mode = WAL');

console.log('\n=== Direct SQL Query Test ===\n');

// Run the exact same query that fetchMemoryCandidates uses
const query = `
  SELECT
    p.*,
    pe.vector as embedding,
    CAST((julianday('now') - julianday(p.created_at)) AS INTEGER) as age_days
  FROM patterns p
  JOIN pattern_embeddings pe ON p.id = pe.id
  WHERE p.type = 'reasoning_memory'
    AND p.confidence >= ?
    AND json_extract(p.pattern_data, '$.domain') = ?
  ORDER BY p.confidence DESC, p.usage_count DESC
`;

const params = [0.3, 'semantic'];

console.log('Query:', query);
console.log('Params:', params);

const stmt = db.prepare(query);
const rows = stmt.all(...params);

console.log('\n✅ Results:', rows.length, 'rows');
if (rows.length > 0) {
  console.log('\nFirst row:');
  console.log('  ID:', rows[0].id);
  console.log('  Type:', rows[0].type);
  console.log('  Confidence:', rows[0].confidence);
  console.log('  pattern_data:', rows[0].pattern_data);
}

db.close();
console.log('\n=== Test Complete ===\n');
