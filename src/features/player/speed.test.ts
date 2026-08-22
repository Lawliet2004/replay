import { describe, expect, it } from "vitest";
import {
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  SPEED_STEP,
  clampSpeed,
  formatSpeedCompact,
  formatSpeedReadout,
  isActivePreset,
  snapSpeed,
  stepSpeed,
} from "./speed";

describe("clampSpeed", () => {
  it("clamps into the documented playback range", () => {
    expect(clampSpeed(-4)).toBe(SPEED_MIN);
    expect(clampSpeed(0)).toBe(SPEED_MIN);
    expect(clampSpeed(99)).toBe(SPEED_MAX);
    expect(clampSpeed(1.25)).toBe(1.25);
  });

  it("falls back to 1x for non-finite input", () => {
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("snapSpeed / stepSpeed", () => {
  it("snaps to SPEED_STEP", () => {
    expect(snapSpeed(1.02)).toBeCloseTo(1, 5);
    expect(snapSpeed(1.13)).toBeCloseTo(1.15, 5);
  });

  it("steps by SPEED_STEP without leaving the range", () => {
    expect(stepSpeed(SPEED_MIN, -1)).toBe(SPEED_MIN);
    expect(stepSpeed(SPEED_MAX, 1)).toBe(SPEED_MAX);
    const up = stepSpeed(1, 1);
    expect(up).toBeGreaterThan(1);
    expect(up).toBeCloseTo(1 + SPEED_STEP, 5);
    const down = stepSpeed(1, -1);
    expect(down).toBeLessThan(1);
    expect(down).toBeCloseTo(1 - SPEED_STEP, 5);
  });
});

describe("SPEED_PRESETS", () => {
  it("includes 1.0 / 1.25 / 1.5 / 2.0 / 3.0 with Normal on 1.0", () => {
    const values = SPEED_PRESETS.map((p) => p.value);
    expect(values).toEqual(expect.arrayContaining([1, 1.25, 1.5, 2, 3]));
    expect(values).toHaveLength(5);
    const normal = SPEED_PRESETS.find((p) => p.value === 1);
    expect(normal?.caption).toBe("Normal");
    expect(normal?.chip).toBe("1.0");
  });
});

describe("formatSpeed", () => {
  it("formats the large readout and compact row value", () => {
    expect(formatSpeedReadout(1)).toBe("1.00x");
    expect(formatSpeedReadout(1.25)).toBe("1.25x");
    expect(formatSpeedCompact(1)).toBe("1.0×");
    expect(formatSpeedCompact(1.75)).toBe("1.75×");
  });
});

describe("isActivePreset", () => {
  it("matches a preset at the current speed", () => {
    expect(isActivePreset(1, 1)).toBe(true);
    expect(isActivePreset(1.75, 1)).toBe(false);
    expect(isActivePreset(2, 2)).toBe(true);
  });
});
