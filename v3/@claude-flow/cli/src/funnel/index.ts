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
  DISCLOSURE_TEXT,
  getDisclosure,
  promoEligible,
  recordDisclosureDeclined,
  recordDisclosureReenabled,
  recordDisclosureShown,
} from './disclosure.js';
export {
  MAX_MESSAGE_COLUMNS,
  MESSAGES,
  containsForbiddenSequences,
  displayWidth,
  eligibleMessages,
  isAllowedUrl,
  isValidMessage,
} from './messages.js';
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
export { deleteFunnelData, getFunnelId, recordFunnelEvent } from './events.js';
export { getFunnelPromo, type PromoContext } from './promo.js';
