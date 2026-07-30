export function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Interpolate displayed position between backend samples (≤4 Hz). */
export function interpolatePosition(
  sampleSecs: number,
  sampleAtMs: number,
  phase: string,
  nowMs = performance.now(),
  speed = 1,
): number {
  if (phase !== "playing") return sampleSecs;
  const delta = ((nowMs - sampleAtMs) / 1000) * speed;
  return Math.max(0, sampleSecs + delta);
}
