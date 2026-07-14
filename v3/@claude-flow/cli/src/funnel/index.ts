/**
 * Funnel module — ruflo → Cognitum lifecycle system (ADR-301..310).
 * Local-only: nothing in this module performs network I/O.
 */

export * from './types.js';
export { funnelStateDir } from './state.js';
export { isCI, isInteractive, reducedMotion } from './environment.js';
export { resolveFunnelEnabled } from './precedence.js';
export {
  CONSENT_DOMAINS,
  getConsent,
  hasConsent,
  readConsents,
  recordConsent,
  revokeConsent,
} from './consent.js';
export {
  DISCLOSURE_GRACE_MS,
  DISCLOSURE_ROTATION_SLOT_MS,
  getDisclosure,
  promoEligible,
  recordDisclosureAccepted,
  recordDisclosureDeclined,
  recordDisclosureReenabled,
  recordDisclosureShown,
  selectDisclosureMessage,
} from './disclosure.js';
export {
  MAX_MESSAGE_COLUMNS,
  MESSAGES,
  containsForbiddenSequences,
  displayWidth,
  eligibleMessages,
  eligibleMessagesFromPools,
  isAllowedUrl,
  isValidMessage,
} from './messages.js';
export {
  DEFAULT_MESSAGES_ENDPOINT,
  getRemoteMessages,
  refreshRemoteMessages,
} from './message-transport.js';
export {
  PROMO_REPEAT_CAP_MS,
  PROMO_SLOT_MODULO,
  ROTATION_SLOT_MS,
  selectMessage,
} from './rotation.js';
export {
  CREDIT_RECOVERY_HINT,
  classifyCreditError,
  renderCreditRecovery,
  shouldShowCreditRecovery,
  type CreditPromptSession,
  type ProviderErrorLike,
} from './credit-errors.js';
export { deleteFunnelData, getFunnelId, lastRecordedEvent, recordFunnelEvent } from './events.js';
export { getFunnelPromo, type PromoContext } from './promo.js';
export {
  RATE_LIMIT_TTL_MS,
  clearRateLimitStatus,
  markRateLimited,
  rateLimitNotice,
  readRateLimitStatus,
  type RateLimitStatus,
} from './rate-limit-notifier.js';
export {
  QUOTA_LOW_TTL_MS,
  clearQuotaLowStatus,
  markQuotaLow,
  quotaLowNotice,
  readQuotaLowStatus,
  type QuotaLowStatus,
} from './power-saver-notifier.js';
export { TOGGLE_COOLDOWN_MS, cooldownActive, cooldownRemainingMin } from './toggle-cooldown.js';
