import { describe, expect, it } from "vitest";
import { formatTime, interpolatePosition } from "./time";

describe("formatTime", () => {
  it("formats seconds", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3661)).toBe("1:01:01");
  });
});

describe("interpolatePosition", () => {
  it("advances only while playing", () => {
    const base = 10;
    const at = 1000;
    expect(interpolatePosition(base, at, "paused", 2000, 1)).toBe(10);
    expect(interpolatePosition(base, at, "playing", 2000, 1)).toBe(11);
  });
});
