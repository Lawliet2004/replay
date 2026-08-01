/** Allowed keyboard seek steps (seconds), matching Settings. */
export const SEEK_STEP_OPTIONS = [5, 10, 20, 30, 60] as const;
export type SeekStepSecs = (typeof SEEK_STEP_OPTIONS)[number];

const DEFAULT_STEP: SeekStepSecs = 5;

let seekStepSecs: SeekStepSecs = DEFAULT_STEP;
const listeners = new Set<() => void>();

export function normalizeSeekStep(value: number): SeekStepSecs {
  const match = SEEK_STEP_OPTIONS.find((s) => s === value);
  return match ?? DEFAULT_STEP;
}

export function getSeekStepSecs(): SeekStepSecs {
  return seekStepSecs;
}

export function setSeekStepSecs(value: number): SeekStepSecs {
  seekStepSecs = normalizeSeekStep(value);
  for (const l of listeners) l();
  return seekStepSecs;
}

export function subscribeSeekStep(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hold-to-accelerate multiplier for arrow seeks.
 * First press = 1×; longer holds ramp up to 8× the configured step.
 */
export function seekHoldMultiplier(heldMs: number): number {
  if (heldMs < 350) return 1;
  if (heldMs < 900) return 2;
  if (heldMs < 1800) return 4;
  return 8;
}
