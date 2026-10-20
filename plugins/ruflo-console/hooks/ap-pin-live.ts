/**
 * The pin's live half (data/ap-pin.ts): where the approval is remembered. In this process, and in the host's own store keyed by the project.
 * Never in the project folder: the steps the autopilot starts can write there.
 */
import { parsePin, pinKey, type Pin } from './data/ap-pin'
import type { Host } from './host'
import type { Store } from './ap-live'

/** Remembers (or, with null, forgets) what the person approved. */
export async function setPin(store: Store, host: Host, cwd: string, pin: Pin | null): Promise<void> {
  store.pin = pin
  store.isPinLoaded = true
  await Promise.resolve(host.storeSet(pinKey(cwd), pin)).catch(() => undefined)
}

/**
 * Loads the pin once per process. A host store that cannot be read adopts the journal as it stands (the gap is that a change made before this
 * process started is not seen); one that is readable and holds none leaves no pin, so a running journal is stopped.
 */
export async function loadPin(store: Store, host: Host, cwd: string): Promise<void> {
  if (store.isPinLoaded) return

  const get = (host as { storeGet?: Host['storeGet'] }).storeGet
  let readable = true
  let held: unknown

  try {
    held = get === undefined ? undefined : await get(pinKey(cwd))
    if (get === undefined) readable = false
  } catch {
    readable = false
  }

  const pin = parsePin(held)

  if (pin !== null) store.pin = pin
  else if (!readable && store.loop.envHash !== null) store.pin = { envHash: store.loop.envHash, starts: store.loop.starts }

  store.isPinLoaded = pin !== null || readable || store.loop.envHash !== null
}
