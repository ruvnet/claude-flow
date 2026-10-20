/**
 * What ruvector 0.3.3 prints under a pipe, captured from runs in a throwaway directory (the hooks and rvf text keep the
 * CLI's colour codes). The identity outputs carry a made-up key: no real key is in this repository.
 */
export const FAKE_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
export const FAKE_PSEUDONYM = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'

export const VEC_OUT = {
  hooksStats: '\u001b[1m\u001b[36m\u001b[39m\u001b[22m\n\u001b[1m\u001b[36m🧠 RuVector Intelligence Stats\u001b[39m\u001b[22m\n\u001b[1m\u001b[36m\u001b[39m\u001b[22m\n  \u001b[32m2\u001b[39m Q-learning patterns\n  \u001b[32m2\u001b[39m vector memories\n  \u001b[32m3\u001b[39m learning trajectories\n  \u001b[32m0\u001b[39m error patterns\n\n\u001b[1mSwarm Status:\u001b[22m\n  \u001b[36m0\u001b[39m agents registered\n  \u001b[36m0\u001b[39m coordination edges\n',
  route: '{\n  "task": "write tests for login",\n  "recommended": "coder",\n  "confidence": 0,\n  "reasoning": "default for unknown files"\n}\n',
  rvfStatus: '\u001b[36mRVF Store Status\u001b[39m\n\u001b[2m  totalVectors: 2\u001b[22m\n\u001b[2m  totalSegments: 2\u001b[22m\n\u001b[2m  epoch: 0\u001b[22m\n\u001b[2m  compactionState: idle\u001b[22m\n',
  identityShow: JSON.stringify({ pseudonym: FAKE_PSEUDONYM, key_preview: `${FAKE_KEY.slice(0, 8)}...${FAKE_KEY.slice(-8)}`, source: '~/.ruvector/pi-key' }, null, 2),
  identityNone: 'No pi key found. Set PI env var or run: ruvector identity generate --save\n',
  generated: `${JSON.stringify({ key: FAKE_KEY, pseudonym: FAKE_PSEUDONYM }, null, 2)}\n  Key saved to /home/dev/.ruvector/pi-key\n`,
  brainMissing: 'Brain commands require @ruvector/pi-brain\n  npm install @ruvector/pi-brain\n',
} as const
