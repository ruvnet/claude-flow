// Test fixture: a "CLI" that is slow like a cold ruflo start and records what it
// received (argv, cwd, stdin) so a test can prove the hook shim returned first
// and still delivered everything (#4128, #4176).
const fs = require('fs');
const out = process.env.HOOK_SLOW_OUT;
const delay = Number(process.env.HOOK_SLOW_MS || 1500);
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
setTimeout(() => {
  if (out) fs.writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin }));
}, delay);
