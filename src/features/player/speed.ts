/** Matches libmpv / player-actor clamp in `SetSpeed`. */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.05;

export type SpeedPreset = {
  value: number;
  chip: string;
  caption?: string;
};

export const SPEED_PRESETS: readonly SpeedPreset[] = [
  { value: 1, chip: "1.0", caption: "Normal" },
  { value: 1.25, chip: "1.25" },
  { value: 1.5, chip: "1.5" },
  { value: 2, chip: "2.0" },
  { value: 3, chip: "3.0" },
];

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

/** Snap to `SPEED_STEP` after clamping. */
export function snapSpeed(speed: number): number {
  const clamped = clampSpeed(speed);
  const snapped = Math.round(clamped / SPEED_STEP) * SPEED_STEP;
  return clampSpeed(Number(snapped.toFixed(2)));
}

export function stepSpeed(speed: number, direction: 1 | -1): number {
  return snapSpeed(clampSpeed(speed) + direction * SPEED_STEP);
}

/** Large readout, e.g. `1.00x`. */
export function formatSpeedReadout(speed: number): string {
  return `${clampSpeed(speed).toFixed(2)}x`;
}

/** Compact value shown on the settings row, e.g. `1.75×`. */
export function formatSpeedCompact(speed: number): string {
  const value = clampSpeed(speed);
  const text = Number.isInteger(value) ? value.toFixed(1) : String(value);
  return `${text}×`;
}

export function isActivePreset(speed: number, preset: number): boolean {
  return Math.abs(clampSpeed(speed) - preset) < 0.001;
}
