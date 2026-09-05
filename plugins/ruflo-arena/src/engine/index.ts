// Engine barrel — pure, side-effect-free competition primitives.
export { mulberry32, randInt, choice, derive } from './rng.js';
export { runMatch, meanPayoff, type MatchOptions } from './arena.js';
export { runTournament, type TournamentOptions } from './tournament.js';
export {
  evolveVsField,
  coevolve,
  fitnessVsField,
  type EvolveOptions,
  type CoevolveOptions,
} from './evolution.js';
