/**
 * Where the boot log reads the self-check's results. A leaf with no imports: the drawing code (frames, the boot picture) must not
 * import the self-check itself, because the self-check reaches the pages, which reach the drawing code. `register.ts`, the root,
 * runs the check once and sets the results here; until it has, the boot log draws as it always did.
 */
export type BootCheck = { area: string; ok: boolean; problems: readonly string[] }

let held: readonly BootCheck[] | undefined

export const setBootChecks = (results: readonly BootCheck[] | undefined): void => {
  held = results
}

export const getBootChecks = (): readonly BootCheck[] | undefined => held
