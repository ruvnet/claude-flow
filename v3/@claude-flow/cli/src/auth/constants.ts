/**
 * Shared ADR-306 constants — split out so `commands/auth.ts` and
 * `auth/client.ts` reference the same keychain service name rather than two
 * independently-typed string literals that could silently drift apart.
 */

export const KEYCHAIN_SERVICE = 'ruflo-cognitum-auth';
