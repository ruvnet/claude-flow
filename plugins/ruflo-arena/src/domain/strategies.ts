// Strategies-as-programs (Ruflo ADR-147/148, RuVector ADR-196). The core representation is
// a deterministic Moore machine: OUTPUT depends on the current state, TRANSITION depends on
// the opponent's last action — Wolfram's "strategy = a simple program reading history".

import { randInt, choice } from '../engine/rng.js';
import type { ActionSymbol, AgentInstance, FsmStrategy, GameSpec, Strategy } from './types.js';

/** Instantiate a runnable agent from a strategy + its own rng stream. */
export function instantiate(strategy: Strategy, rng: () => number): AgentInstance {
  if (strategy.kind === 'fn') {
    let state = strategy.init(rng);
    return {
      act: () => strategy.act(state, rng),
      observe: (own, opp) => {
        state = strategy.update(state, own, opp, rng);
      },
    };
  }
  let cur = strategy.start;
  return {
    act: () => strategy.states[cur].action,
    observe: (_own, opp) => {
      const next = strategy.states[cur].next[opp];
      cur = next === undefined ? cur : next; // guard: unknown action => stay
    },
  };
}

// --- Classic library (factories parameterized by the game's action set) --------------------

export function constant(actions: readonly ActionSymbol[], idx: number, name?: string): FsmStrategy {
  const a = actions[idx];
  const next = Object.fromEntries(actions.map((x) => [x, 0]));
  return { kind: 'fsm', name: name ?? `always-${a}`, nStates: 1, start: 0, states: [{ action: a, next }] };
}

export function copyOpponent(actions: readonly ActionSymbol[], startIdx = 0, name?: string): FsmStrategy {
  const states = actions.map((a) => ({
    action: a,
    next: Object.fromEntries(actions.map((x, j) => [x, j])),
  }));
  return { kind: 'fsm', name: name ?? 'tit-for-tat', nStates: actions.length, start: startIdx, states };
}

export function antiCopy(actions: readonly ActionSymbol[], startIdx = 0, name?: string): FsmStrategy {
  const states = actions.map((a) => ({
    action: a,
    next: Object.fromEntries(actions.map((x, j) => [x, (j + 1) % actions.length])),
  }));
  return { kind: 'fsm', name: name ?? 'anti-tit-for-tat', nStates: actions.length, start: startIdx, states };
}

export function alternate(actions: readonly ActionSymbol[], name?: string): FsmStrategy {
  const states = actions.map((a, i) => ({
    action: a,
    next: Object.fromEntries(actions.map((x) => [x, (i + 1) % actions.length])),
  }));
  return { kind: 'fsm', name: name ?? 'alternate', nStates: actions.length, start: 0, states };
}

/** Cooperate until the opponent plays actions[1], then play actions[1] forever. */
export function grim(actions: readonly ActionSymbol[], name?: string): FsmStrategy {
  const [nice, mean] = actions;
  return {
    kind: 'fsm',
    name: name ?? 'grim',
    nStates: 2,
    start: 0,
    states: [
      { action: nice, next: { [nice]: 0, [mean]: 1 } },
      { action: mean, next: { [nice]: 1, [mean]: 1 } },
    ],
  };
}

/** Win-Stay-Lose-Shift / Pavlov: repeat last action iff actions matched last round. */
export function pavlov(actions: readonly ActionSymbol[], name?: string): FsmStrategy {
  const [c, d] = actions;
  return {
    kind: 'fsm',
    name: name ?? 'pavlov',
    nStates: 2,
    start: 0,
    states: [
      { action: c, next: { [c]: 0, [d]: 1 } },
      { action: d, next: { [d]: 0, [c]: 1 } },
    ],
  };
}

/** Uniformly random action (exercises the seeded rng; a closure strategy). */
export function random(actions: readonly ActionSymbol[], name?: string): Strategy {
  return {
    kind: 'fn',
    name: name ?? 'random',
    init: () => null,
    act: (_s, rng) => choice(rng, actions),
    update: (s) => s,
  };
}

/** A sensible spread of opponents for a given game. */
export function classicRoster(game: GameSpec): Strategy[] {
  const a = game.actions;
  if (game.name === 'prisoners-dilemma') {
    return [
      copyOpponent(a, 0, 'tit-for-tat'),
      constant(a, 0, 'always-cooperate'),
      constant(a, 1, 'always-defect'),
      grim(a, 'grim'),
      pavlov(a, 'pavlov'),
      antiCopy(a, 0, 'suspicious-anti-tft'),
      alternate(a, 'alternate'),
      random(a, 'random'),
    ];
  }
  return [
    constant(a, 0, `always-${a[0]}`),
    constant(a, 1, `always-${a[1]}`),
    copyOpponent(a, 0, 'copy-opponent'),
    antiCopy(a, 0, 'anti-copy'),
    alternate(a, 'alternate'),
    random(a, 'random'),
  ];
}

export function findStrategy(game: GameSpec, name: string): Strategy {
  const roster = classicRoster(game);
  const s = roster.find((r) => r.name === name || r.name.startsWith(name));
  if (!s) throw new Error(`unknown strategy "${name}". Available: ${roster.map((r) => r.name).join(', ')}`);
  return s;
}

// --- Evolvable FSMs — random genomes + mutation operators (ADR-148) ------------------------

export function randomFSM(game: GameSpec, rng: () => number, nStates = 2, name = 'evolved'): FsmStrategy {
  const a = game.actions;
  const states = [];
  for (let i = 0; i < nStates; i++) {
    states.push({
      action: choice(rng, a),
      next: Object.fromEntries(a.map((x) => [x, randInt(rng, nStates)])),
    });
  }
  return { kind: 'fsm', name, nStates, start: randInt(rng, nStates), states };
}

function cloneFSM(fsm: FsmStrategy): FsmStrategy {
  return {
    kind: 'fsm',
    name: fsm.name,
    nStates: fsm.nStates,
    start: fsm.start,
    states: fsm.states.map((s) => ({ action: s.action, next: { ...s.next } })),
  };
}

const MUTATORS = ['flipAction', 'rewire', 'moveStart', 'addState', 'removeState'] as const;

/** Return a mutated copy of an FSM (one random structural edit). */
export function mutate(fsm: FsmStrategy, game: GameSpec, rng: () => number): FsmStrategy {
  const a = game.actions;
  const m = cloneFSM(fsm);
  let op: (typeof MUTATORS)[number] = choice(rng, MUTATORS);
  if (op === 'removeState' && m.nStates <= 1) op = 'addState';

  if (op === 'flipAction') {
    m.states[randInt(rng, m.nStates)].action = choice(rng, a);
  } else if (op === 'rewire') {
    const s = randInt(rng, m.nStates);
    m.states[s].next[choice(rng, a)] = randInt(rng, m.nStates);
  } else if (op === 'moveStart') {
    m.start = randInt(rng, m.nStates);
  } else if (op === 'addState') {
    const idx = m.nStates;
    m.states.push({
      action: choice(rng, a),
      next: Object.fromEntries(a.map((x) => [x, randInt(rng, idx + 1)])),
    });
    m.nStates += 1;
    m.states[randInt(rng, idx)].next[choice(rng, a)] = idx; // make new state reachable
  } else {
    const victim = randInt(rng, m.nStates);
    m.states.splice(victim, 1);
    m.nStates -= 1;
    const remap = (t: number) => (t === victim ? 0 : t > victim ? t - 1 : t);
    for (const st of m.states) for (const k of a) st.next[k] = remap(st.next[k]);
    m.start = remap(m.start);
  }
  return m;
}
