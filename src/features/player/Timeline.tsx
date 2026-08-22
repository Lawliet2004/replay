import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { interpolatePosition } from "./time";
import { dispatch, usePlayerSnapshot } from "./store";

/** Ignore stale backend samples until they land near the seek target. */
const SEEK_CATCHUP_SECS = 0.4;
/** Drop pending seek if mpv never confirms (stuck). */
const SEEK_HOLD_MS = 1500;

export function Timeline() {
  const snap = usePlayerSnapshot();
  const sampleAt = useRef(performance.now());
  const lastSample = useRef(snap.positionSecs);
  const displayRef = useRef(snap.positionSecs);
  const [display, setDisplay] = useState(snap.positionSecs);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  /** Optimistic position after click/scrub until backend catches up. */
  const pendingSeek = useRef<number | null>(null);
  const pendingSince = useRef(0);
  const draggingRef = useRef(false);

  const commitDisplay = useCallback((secs: number) => {
    displayRef.current = secs;
    setDisplay(secs);
  }, []);

  const acceptBackendSample = useCallback(
    (secs: number) => {
      if (draggingRef.current) return;

      const pending = pendingSeek.current;
      if (pending != null) {
        const age = performance.now() - pendingSince.current;
        const close = Math.abs(secs - pending) <= SEEK_CATCHUP_SECS;
        if (!close && age < SEEK_HOLD_MS) {
          // Stale sample from before the seek — keep thumb on target.
          return;
        }
        pendingSeek.current = null;
      }

      lastSample.current = secs;
      sampleAt.current = performance.now();
      // Hard snap only when not mid-seek; avoids 1→5 min rubber-band.
      commitDisplay(secs);
    },
    [commitDisplay],
  );

  useEffect(() => {
    acceptBackendSample(snap.positionSecs);
  }, [snap.positionSecs, snap.revision, acceptBackendSample]);

  // rAF clock while playing (and not scrubbing / holding a seek).
  useEffect(() => {
    if (dragging || snap.phase !== "playing") return;
    let raf = 0;
    const loop = () => {
      if (pendingSeek.current == null) {
        const next = interpolatePosition(
          lastSample.current,
          sampleAt.current,
          snap.phase,
          performance.now(),
          snap.speed,
        );
        const capped = snap.durationSecs > 0 ? Math.min(next, snap.durationSecs) : next;
        commitDisplay(capped);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dragging, snap.phase, snap.speed, snap.durationSecs, commitDisplay]);

  const beginDrag = (current: number) => {
    draggingRef.current = true;
    pendingSeek.current = null;
    setDragging(true);
    setDragValue(current);
  };

  const finishSeek = (v: number) => {
    const max = Math.max(snap.durationSecs || 0, 0.1);
    const target = Math.min(Math.max(0, v), max);
    draggingRef.current = false;
    setDragging(false);
    // Optimistic: park thumb immediately so it never rubber-bands to old time.
    pendingSeek.current = target;
    pendingSince.current = performance.now();
    lastSample.current = target;
    sampleAt.current = performance.now();
    commitDisplay(target);
    void dispatch({
      type: "seek",
      position_secs: target,
      absolute: true,
    });
  };

  const value = dragging ? dragValue : display;
  const max = Math.max(snap.durationSecs || 0, 0.1);
  const progress = max > 0 ? (Math.min(value, max) / max) * 100 : 0;

  return (
    <div className="timeline">
      <input
        className="timeline-range"
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={Math.min(value, max)}
        aria-label="Seek"
        style={{ ["--range-progress" as string]: `${progress}%` } as CSSProperties}
        onPointerDown={(e) => {
          const el = e.currentTarget;
          // Capture so drag stays smooth if pointer leaves the thumb.
          el.setPointerCapture(e.pointerId);
          beginDrag(Number(el.value));
        }}
        onPointerUp={(e) => {
          const el = e.currentTarget;
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
          finishSeek(Number(el.value));
        }}
        onPointerCancel={(e) => {
          const el = e.currentTarget;
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
          finishSeek(Number(el.value));
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDragValue(v);
          // Live visual while scrubbing (no backend spam).
          if (draggingRef.current) commitDisplay(v);
        }}
      />
    </div>
  );
}
