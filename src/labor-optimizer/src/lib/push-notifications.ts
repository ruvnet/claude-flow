/**
 * Push notifications stub.
 * When Capacitor is installed (bash scripts/setup-capacitor.sh),
 * replace this with the full implementation from CAPACITOR.md.
 */
export async function initPushNotifications(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
    console.log('[Push] Native platform detected — run setup-capacitor.sh to enable');
  }
}
