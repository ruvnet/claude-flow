/**
 * Neural Domain Layer - Public Exports
 *
 * @module v3/neural/domain
 */

export {
  Pattern,
  type PatternType,
  type PatternProps,
} from './entities/pattern.js';

export {
  LearningDomainService,
  type Trajectory,
  type LearningResult,
  type RouteRecommendation,
} from './services/learning-service.js';
